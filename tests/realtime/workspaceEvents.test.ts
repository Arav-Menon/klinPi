import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Workspace events flow: the runtime publishes WORKSPACE_EVENT envelopes on
 * the per-session Redis channel (`agent:session:{sessionId}`); the realtime
 * SessionRouter (already subscribed for every connected socket) fans them
 * out to that session's sockets only. These tests pin the fan-out contract
 * for the workspace envelope shape — no transport changes needed.
 */

const redisMock = vi.hoisted(() => ({
    callbacks: new Map<string, (channel: string, message: string) => void>(),
    publish: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
}));

vi.mock("../../packages/realtime/src/services/redis-manger.js", () => ({
    redisManger: {
        publish: redisMock.publish,
        subscribe: redisMock.subscribe,
        unsubscribe: redisMock.unsubscribe,
    },
}));

const cacheMock = vi.hoisted(() => ({
    getCache: vi.fn(),
    setCache: vi.fn(),
    deleteCache: vi.fn(),
}));

vi.mock("../../packages/realtime/src/lib/cache.js", () => ({
    cacheData: cacheMock,
}));

const dbMock = vi.hoisted(() => {
    const state = { rows: [] as any[] };
    const db = vi.fn(() => ({
        select: () => ({
            from: () => ({
                where: () => ({
                    limit: async () => state.rows,
                }),
            }),
        }),
    }));
    return { state, db };
});

vi.mock("../../packages/realtime/src/lib/db.js", () => ({
    db: dbMock.db,
}));

const rpcMock = vi.hoisted(() => ({
    runAgent: vi.fn(),
}));

vi.mock("../../packages/realtime/src/services/client-RPC/rpc-client.js", () => ({
    clientRPC: rpcMock,
}));

import { sessionRouter } from "../../packages/realtime/src/modules/SessionRouter.js";
import { channels } from "../../packages/realtime/src/lib/redisKeys.js";
import { agentSessionChannel } from "../../packages/runtime/src/workspace/publish.js";
import { workspaceEventEnvelope } from "../../packages/runtime/src/workspace/events.js";
import type { WorkspaceEvent } from "../../packages/runtime/src/workspace/events.js";

const OPEN = 1;

let counter = 0;
function uniqueSessionId(label: string): string {
    counter += 1;
    return `ws-sess-${label}-${counter}`;
}

function createSocket(readyState: number = OPEN) {
    return { readyState, send: vi.fn() } as any;
}

function flush(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Deliver a Redis message the way the realtime subscriber would. */
function deliverViaRedis(sessionId: string, envelope: unknown): void {
    const channel = channels.agentSession(sessionId);
    const callback = redisMock.callbacks.get(channel);
    if (!callback) throw new Error(`no redis subscriber registered for ${channel}`);
    callback(channel, JSON.stringify(envelope));
}

beforeEach(() => {
    vi.clearAllMocks();
    redisMock.callbacks.clear();
    dbMock.state.rows = [];

    redisMock.publish.mockResolvedValue(1);
    redisMock.unsubscribe.mockImplementation(async (channel: string) => {
        redisMock.callbacks.delete(channel);
        return undefined;
    });
    redisMock.subscribe.mockImplementation(async (channel: string, callback: any) => {
        redisMock.callbacks.set(channel, callback);
        return 1;
    });

    cacheMock.getCache.mockResolvedValue(null);
    cacheMock.setCache.mockResolvedValue(undefined);
});

describe("workspace event channel contract", () => {
    it("uses the same channel name as the realtime session router", () => {
        const sessionId = uniqueSessionId("channel");
        expect(agentSessionChannel(sessionId)).toBe(channels.agentSession(sessionId));
        expect(agentSessionChannel(sessionId)).toBe(`agent:session:${sessionId}`);
    });
});

describe("SessionRouter fan-out for WORKSPACE_EVENT", () => {
    it("delivers workspace envelopes to every subscribed socket", async () => {
        const sessionId = uniqueSessionId("fanout");
        const first = createSocket();
        const second = createSocket();
        await sessionRouter.register(first, sessionId);
        await sessionRouter.register(second, sessionId);

        const event: WorkspaceEvent = {
            sessionId,
            type: "workspace.file.updated",
            path: "src/app.ts",
            timestamp: 1_700_000_000_000,
        };
        const envelope = workspaceEventEnvelope(event);

        // The runtime publishes directly to Redis (fire-and-forget).
        await redisMock.publish(agentSessionChannel(sessionId), JSON.stringify(envelope));
        deliverViaRedis(sessionId, envelope);

        for (const socket of [first, second]) {
            expect(socket.send).toHaveBeenCalledTimes(1);
            const frame = JSON.parse(socket.send.mock.calls[0]![0]);
            expect(frame).toEqual({ type: "WORKSPACE_EVENT", event });
            expect(frame.event.path).toBe("src/app.ts");
        }
    });

    it("never leaks workspace events across sessions", async () => {
        const sessionA = uniqueSessionId("iso-a");
        const sessionB = uniqueSessionId("iso-b");
        const socketA = createSocket();
        const socketB = createSocket();
        await sessionRouter.register(socketA, sessionA);
        await sessionRouter.register(socketB, sessionB);

        const envelope = workspaceEventEnvelope({
            sessionId: sessionA,
            type: "workspace.tree.resync_required",
            reason: "coalesce",
            timestamp: Date.now(),
        });
        deliverViaRedis(sessionA, envelope);

        expect(socketA.send).toHaveBeenCalledTimes(1);
        expect(socketB.send).not.toHaveBeenCalled();
    });

    it("preserves resync and ready envelope shapes end to end", async () => {
        const sessionId = uniqueSessionId("shapes");
        const socket = createSocket();
        await sessionRouter.register(socket, sessionId);

        const ready = workspaceEventEnvelope({
            sessionId,
            type: "workspace.ready",
            timestamp: Date.now(),
        });
        const resync = workspaceEventEnvelope({
            sessionId,
            type: "workspace.tree.resync_required",
            reason: "watch_error",
            timestamp: Date.now(),
        });

        deliverViaRedis(sessionId, ready);
        deliverViaRedis(sessionId, resync);

        expect(socket.send).toHaveBeenCalledTimes(2);
        const first = JSON.parse(socket.send.mock.calls[0]![0]);
        const second = JSON.parse(socket.send.mock.calls[1]![0]);
        expect(first).toMatchObject({ type: "WORKSPACE_EVENT", event: { type: "workspace.ready" } });
        expect(second).toMatchObject({
            type: "WORKSPACE_EVENT",
            event: { type: "workspace.tree.resync_required", reason: "watch_error" },
        });
    });

    it("tolerates a workspace publish after the room emptied", async () => {
        const sessionId = uniqueSessionId("empty");
        const socket = createSocket();
        await sessionRouter.register(socket, sessionId);
        sessionRouter.unsubscribeAll(socket);
        await flush();

        // Room is empty (redis unsubscribed); a late publish must not throw
        // and must not deliver to the departed socket.
        const envelope = workspaceEventEnvelope({
            sessionId,
            type: "workspace.file.created",
            path: "new.ts",
            timestamp: Date.now(),
        });
        await expect(sessionRouter.publish(sessionId, envelope)).resolves.toBeUndefined();
        expect(socket.send).not.toHaveBeenCalled();
    });
});
