import { pubClient } from "@klinpi/redis";
import { workspaceEventEnvelope, type WorkspaceEvent } from "./events.js";

/**
 * Channel factory — must stay in lockstep with the realtime service's
 * `channels.agentSession` (packages/realtime/src/lib/redisKeys.ts). The
 * realtime SessionRouter subscribes this channel for every session room
 * (with ownership enforced at subscribe time), so publishing here reaches
 * exactly the authorized sockets — across realtime instances via Redis.
 */
export function agentSessionChannel(sessionId: string): string {
    return `agent:session:${sessionId}`;
}

export type WorkspacePublisher = (sessionId: string, event: WorkspaceEvent) => Promise<void>;

/** Production publisher: fire-and-forget Redis fan-out (events are best-effort). */
export const publishWorkspaceEvent: WorkspacePublisher = async (sessionId, event) => {
    try {
        await pubClient.publish(
            agentSessionChannel(sessionId),
            JSON.stringify(workspaceEventEnvelope(event)),
        );
    } catch (error) {
        console.warn(
            `[Workspace] Failed to publish ${event.type} for session ${sessionId}:`,
            error instanceof Error ? error.message : error,
        );
    }
};
