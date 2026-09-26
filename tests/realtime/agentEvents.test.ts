import { describe, it, expect, beforeEach, vi } from "vitest";

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
        insert: () => ({
            values: (values: any) => ({
                returning: async () => [
                    {
                        id: "new-session-id",
                        repositoryId: null,
                        ...values,
                    },
                ],
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

import {
    AgentSessionManager,
    normalizeEventType,
} from "../../packages/realtime/src/modules/AgentSessionManager.js";
import { sessionRouter } from "../../packages/realtime/src/modules/SessionRouter.js";
import { channels } from "../../packages/realtime/src/lib/redisKeys.js";

const OPEN = 1;
const CLOSED = 3;

let sessionCounter = 0;
function uniqueSessionId(label: string): string {
    sessionCounter += 1;
    return `sess-${label}-${sessionCounter}`;
}

function createSocket(readyState: number = OPEN) {
    return { readyState, send: vi.fn() } as any;
}

function createStream() {
    const handlers: Record<string, (arg?: any) => void> = {};
    return {
        handlers,
        stream: {
            on: vi.fn((event: string, handler: (arg?: any) => void) => {
                handlers[event] = handler;
            }),
        },
    };
}

function flush(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

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
    cacheMock.deleteCache.mockResolvedValue(undefined);
});

describe("SessionRouter", () => {
    it("accepts a subscriber whose user owns the cached session", async () => {
        const sessionId = uniqueSessionId("owner");
        const socket = createSocket();
        cacheMock.getCache.mockResolvedValue({ id: sessionId, userId: "user-1", repositoryId: null });

        await sessionRouter.subscribe(socket, sessionId, "user-1");

        expect(redisMock.subscribe).toHaveBeenCalledWith(channels.agentSession(sessionId), expect.any(Function));
    });

    it("rejects a subscriber when the session belongs to another user", async () => {
        const sessionId = uniqueSessionId("intruder");
        const socket = createSocket();
        cacheMock.getCache.mockResolvedValue({ id: sessionId, userId: "owner", repositoryId: null });
        dbMock.state.rows = [];

        await expect(sessionRouter.subscribe(socket, sessionId, "intruder")).rejects.toThrow(
            "Not authorized for this session",
        );
        expect(redisMock.subscribe).not.toHaveBeenCalled();
    });

    it("authorizes a subscriber through the database when the cache is cold", async () => {
        const sessionId = uniqueSessionId("cold");
        const socket = createSocket();
        cacheMock.getCache.mockResolvedValue(null);
        dbMock.state.rows = [{ id: sessionId, userId: "user-1", repositoryId: null }];

        await sessionRouter.subscribe(socket, sessionId, "user-1");

        expect(redisMock.subscribe).toHaveBeenCalledWith(channels.agentSession(sessionId), expect.any(Function));
        expect(cacheMock.setCache).toHaveBeenCalledWith(
            `session:${sessionId}`,
            { id: sessionId, userId: "user-1", repositoryId: null },
            expect.any(Number),
        );
    });

    it("publishes over redis on the agent session channel and delivers to every subscribed socket (multi-client)", async () => {
        const sessionId = uniqueSessionId("multi");
        const first = createSocket();
        const second = createSocket();
        await sessionRouter.register(first, sessionId);
        await sessionRouter.register(second, sessionId);

        const envelope = { type: "AGENT_EVENT", event: { sessionId, sequence: 0 } };
        await sessionRouter.publish(sessionId, envelope);

        expect(redisMock.publish).toHaveBeenCalledTimes(1);
        expect(redisMock.publish).toHaveBeenCalledWith(
            channels.agentSession(sessionId),
            JSON.stringify(envelope),
        );
        expect(first.send).not.toHaveBeenCalled();
        expect(second.send).not.toHaveBeenCalled();

        deliverViaRedis(sessionId, envelope);

        expect(first.send).toHaveBeenCalledTimes(1);
        expect(second.send).toHaveBeenCalledTimes(1);
        expect(JSON.parse(first.send.mock.calls[0][0])).toEqual(envelope);
    });

    it("never delivers session A events to session B sockets", async () => {
        const sessionA = uniqueSessionId("iso-a");
        const sessionB = uniqueSessionId("iso-b");
        const socketA = createSocket();
        const socketB = createSocket();
        await sessionRouter.register(socketA, sessionA);
        await sessionRouter.register(socketB, sessionB);

        const envelope = { type: "AGENT_EVENT", event: { sessionId: sessionA, sequence: 1 } };
        await sessionRouter.publish(sessionA, envelope);
        deliverViaRedis(sessionA, envelope);

        expect(socketA.send).toHaveBeenCalledTimes(1);
        expect(socketB.send).not.toHaveBeenCalled();
    });

    it("skips disconnected sockets without crashing the delivery", async () => {
        const sessionId = uniqueSessionId("closed");
        const closed = createSocket(CLOSED);
        const open = createSocket();
        await sessionRouter.register(closed, sessionId);
        await sessionRouter.register(open, sessionId);

        const envelope = { type: "AGENT_EVENT", event: { sessionId, sequence: 0 } };
        await sessionRouter.publish(sessionId, envelope);
        expect(() => deliverViaRedis(sessionId, envelope)).not.toThrow();

        expect(closed.send).not.toHaveBeenCalled();
        expect(open.send).toHaveBeenCalledTimes(1);
    });

    it("falls back to local delivery exactly once when redis publish fails", async () => {
        const sessionId = uniqueSessionId("fallback");
        const socket = createSocket();
        await sessionRouter.register(socket, sessionId);
        redisMock.publish.mockRejectedValueOnce(new Error("redis down"));

        const first = { type: "AGENT_EVENT", event: { sessionId, sequence: 0 } };
        await sessionRouter.publish(sessionId, first);

        expect(socket.send).toHaveBeenCalledTimes(1);
        expect(JSON.parse(socket.send.mock.calls[0][0])).toEqual(first);

        const second = { type: "AGENT_EVENT", event: { sessionId, sequence: 1 } };
        await sessionRouter.publish(sessionId, second);

        expect(redisMock.publish).toHaveBeenCalledTimes(1);
        expect(socket.send).toHaveBeenCalledTimes(2);
    });

    it("unsubscribes from redis and stops delivery when the socket disconnects", async () => {
        const sessionId = uniqueSessionId("close");
        const socket = createSocket();
        await sessionRouter.register(socket, sessionId);

        sessionRouter.unsubscribeAll(socket);

        expect(redisMock.unsubscribe).toHaveBeenCalledWith(channels.agentSession(sessionId), expect.any(Function));
        expect(redisMock.callbacks.has(channels.agentSession(sessionId))).toBe(false);

        await sessionRouter.publish(sessionId, { type: "AGENT_EVENT", event: { sessionId, sequence: 0 } });
        expect(socket.send).not.toHaveBeenCalled();
    });
});

describe("AgentSessionManager", () => {
    it("calls RunAgent with the correct request after subscribing the initiating socket", async () => {
        const sessionId = uniqueSessionId("request");
        const { stream } = createStream();
        rpcMock.runAgent.mockReturnValue(stream);
        cacheMock.getCache.mockResolvedValue({ id: sessionId, userId: "user-1", repositoryId: "repo-9" });
        const socket = createSocket();

        const manager = new AgentSessionManager();
        await manager.SessionCheck({
            userId: "user-1",
            sessionId,
            prompt: "hello there",
            repositoryId: undefined,
            socket,
        });

        expect(rpcMock.runAgent).toHaveBeenCalledWith({
            sessionId,
            userId: "user-1",
            prompt: "hello there",
            repositoryId: "repo-9",
        });
        expect(redisMock.subscribe).toHaveBeenCalledTimes(1);
        expect(redisMock.subscribe.mock.invocationCallOrder[0]).toBeLessThan(
            rpcMock.runAgent.mock.invocationCallOrder[0]!,
        );
    });

    it("creates a session when no sessionId is given and passes the generated id to RunAgent", async () => {
        const { stream } = createStream();
        rpcMock.runAgent.mockReturnValue(stream);
        const socket = createSocket();

        const manager = new AgentSessionManager();
        await manager.SessionCheck({
            userId: "user-1",
            sessionId: undefined,
            prompt: "start a brand new conversation",
            repositoryId: undefined,
            socket,
        });

        expect(rpcMock.runAgent).toHaveBeenCalledWith(
            expect.objectContaining({
                sessionId: "new-session-id",
                userId: "user-1",
                prompt: "start a brand new conversation",
            }),
        );
        expect(cacheMock.deleteCache).toHaveBeenCalledWith("user:user-1:sessions:recent");
    });

    it("resolves an existing session from the database when the cache is cold", async () => {
        const sessionId = uniqueSessionId("cold-session");
        const { stream } = createStream();
        rpcMock.runAgent.mockReturnValue(stream);
        cacheMock.getCache.mockResolvedValue(null);
        dbMock.state.rows = [{ id: sessionId, userId: "user-1", repositoryId: "repo-7" }];
        const socket = createSocket();

        const manager = new AgentSessionManager();
        await manager.SessionCheck({
            userId: "user-1",
            sessionId,
            prompt: "continue",
            repositoryId: undefined,
            socket,
        });

        expect(rpcMock.runAgent).toHaveBeenCalledWith({
            sessionId,
            userId: "user-1",
            prompt: "continue",
            repositoryId: "repo-7",
        });
        expect(cacheMock.setCache).toHaveBeenCalledWith(
            `session:${sessionId}`,
            { id: sessionId, userId: "user-1", repositoryId: "repo-7" },
            expect.any(Number),
        );
    });

    it("reports an error and does not call RunAgent when the session cannot be found", async () => {
        const sessionId = uniqueSessionId("missing");
        const socket = createSocket();
        cacheMock.getCache.mockResolvedValue(null);
        dbMock.state.rows = [];

        const manager = new AgentSessionManager();
        await manager.SessionCheck({
            userId: "user-1",
            sessionId,
            prompt: "hello",
            repositoryId: undefined,
            socket,
        });

        expect(rpcMock.runAgent).not.toHaveBeenCalled();
        expect(socket.send).toHaveBeenCalledTimes(1);
        expect(JSON.parse(socket.send.mock.calls[0][0])).toEqual({
            type: "error",
            message: "Session not found",
        });
    });

    const eventTypeCases = [
        { type: 1, eventType: "AGENT_MESSAGE" },
        { type: 2, eventType: "AGENT_STATUS" },
        { type: 3, eventType: "TOOL_CALL" },
        { type: 4, eventType: "TOOL_RESULT" },
        { type: 5, eventType: "AGENT_ERROR" },
        { type: 6, eventType: "AGENT_COMPLETED" },
    ];

    for (const eventCase of eventTypeCases) {
        it(`forwards ${eventCase.eventType} with the complete envelope`, async () => {
            const sessionId = uniqueSessionId(eventCase.eventType);
            const { stream, handlers } = createStream();
            rpcMock.runAgent.mockReturnValue(stream);
            const socket = createSocket();

            const manager = new AgentSessionManager();
            manager.ClientCall({ userId: "user-1", sessionId, prompt: "p", socket });

            handlers.data({
                sessionId,
                type: eventCase.type,
                content: `content for ${eventCase.eventType}`,
                toolCall: { id: "tc-1", name: "read_file", arguments: "{}" },
                toolResult: { toolCallId: "tc-1", output: "ok", isError: false },
                timestamp: 1700000000000,
                sequence: 5,
            });
            await flush();

            expect(redisMock.publish).toHaveBeenCalledTimes(1);
            const [channel, payload] = redisMock.publish.mock.calls[0]!;
            expect(channel).toBe(channels.agentSession(sessionId));
            expect(JSON.parse(payload as string)).toEqual({
                type: "AGENT_EVENT",
                event: {
                    userId: "user-1",
                    sessionId,
                    eventType: eventCase.eventType,
                    content: `content for ${eventCase.eventType}`,
                    toolCall: { id: "tc-1", name: "read_file", arguments: "{}" },
                    toolResult: { toolCallId: "tc-1", output: "ok", isError: false },
                    timestamp: 1700000000000,
                    sequence: 5,
                },
            });
        });
    }

    it("normalizes numeric, string and unknown event types", () => {
        expect(normalizeEventType(3)).toBe("TOOL_CALL");
        expect(normalizeEventType("AGENT_STATUS")).toBe("AGENT_STATUS");
        expect(normalizeEventType(99)).toBe("EVENT_TYPE_UNSPECIFIED");
        expect(normalizeEventType(undefined)).toBe("EVENT_TYPE_UNSPECIFIED");
    });

    it("converts Long-style timestamps to plain numbers", async () => {
        const sessionId = uniqueSessionId("long-ts");
        const { stream, handlers } = createStream();
        rpcMock.runAgent.mockReturnValue(stream);
        const socket = createSocket();

        const manager = new AgentSessionManager();
        manager.ClientCall({ userId: "user-1", sessionId, prompt: "p", socket });

        handlers.data({
            sessionId,
            type: "AGENT_STATUS",
            content: "working",
            timestamp: { toNumber: () => 1700000000123 },
            sequence: 1,
        });
        handlers.data({
            sessionId,
            type: "AGENT_STATUS",
            content: "working",
            timestamp: { low: -665017856, high: 416, unsigned: false },
            sequence: 2,
        });
        await flush();

        expect(redisMock.publish).toHaveBeenCalledTimes(2);
        const firstEnvelope = JSON.parse(redisMock.publish.mock.calls[0]![1] as string);
        const secondEnvelope = JSON.parse(redisMock.publish.mock.calls[1]![1] as string);
        expect(firstEnvelope.event.timestamp).toBe(1700000000123);
        expect(secondEnvelope.event.timestamp).toBe(1790336344576);
        expect(firstEnvelope.event.eventType).toBe("AGENT_STATUS");
    });

    it("publishes each event incrementally and never emits a duplicate completion on stream end", async () => {
        const sessionId = uniqueSessionId("incremental");
        const { stream, handlers } = createStream();
        rpcMock.runAgent.mockReturnValue(stream);
        const socket = createSocket();

        const manager = new AgentSessionManager();
        manager.ClientCall({ userId: "user-1", sessionId, prompt: "p", socket });

        handlers.data({ sessionId, type: "AGENT_STATUS", content: "step 1", timestamp: 1, sequence: 0 });
        await flush();
        expect(redisMock.publish).toHaveBeenCalledTimes(1);

        handlers.data({ sessionId, type: "AGENT_STATUS", content: "step 2", timestamp: 2, sequence: 1 });
        await flush();
        expect(redisMock.publish).toHaveBeenCalledTimes(2);

        handlers.end();
        await flush();
        expect(redisMock.publish).toHaveBeenCalledTimes(2);
        expect(socket.send).not.toHaveBeenCalled();
    });

    it("sends a sanitized error envelope to the initiating socket when the gRPC stream fails", async () => {
        const sessionId = uniqueSessionId("stream-error");
        const { stream, handlers } = createStream();
        rpcMock.runAgent.mockReturnValue(stream);
        const socket = createSocket();

        const manager = new AgentSessionManager();
        manager.ClientCall({ userId: "user-1", sessionId, prompt: "p", socket });

        handlers.error(new Error("secret internal grpc failure"));
        await flush();

        expect(socket.send).toHaveBeenCalledTimes(1);
        const payload = JSON.parse(socket.send.mock.calls[0][0]);
        expect(payload).toEqual({ type: "error", message: "Agent stream failed" });
        expect(socket.send.mock.calls[0][0]).not.toContain("secret");
    });
});
