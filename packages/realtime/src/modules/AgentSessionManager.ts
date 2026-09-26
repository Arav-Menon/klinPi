import type { WebSocket } from "ws";
import { db } from "../lib/db.js";
import { agentSessions } from "@klinpi/db/schema";
import { eq, and } from "drizzle-orm";
import { cacheData } from "../lib/cache.js";
import { CACHE_TTL, cacheKeys } from "../lib/redisKeys.js";
import { clientRPC } from "../services/client-RPC/rpc-client.js";
import { sessionRouter, safeSend } from "./SessionRouter.js";

export interface AgentCallData extends ClientRpc {
    repositoryId?: string | undefined;
    socket: WebSocket;
}

interface ClientRpc {
    userId: string;
    sessionId?: string | undefined;
    prompt: string;
    socket: WebSocket;
    repositoryId?: string | undefined;
}

interface SessionRecord {
    id: string;
    userId: string;
    repositoryId: string | null;
}

export const EVENT_TYPE_NAMES: Record<number, string> = {
    0: "EVENT_TYPE_UNSPECIFIED",
    1: "AGENT_MESSAGE",
    2: "AGENT_STATUS",
    3: "TOOL_CALL",
    4: "TOOL_RESULT",
    5: "AGENT_ERROR",
    6: "AGENT_COMPLETED",
};

export function normalizeEventType(type: unknown): string {
    if (typeof type === "string" && type.length > 0) return type;
    if (typeof type === "number") return EVENT_TYPE_NAMES[type] ?? "EVENT_TYPE_UNSPECIFIED";
    return "EVENT_TYPE_UNSPECIFIED";
}

function toTimestamp(value: unknown): number {
    if (typeof value === "number") return value;
    if (typeof value === "string") return Number(value) || 0;
    if (value && typeof value === "object") {
        const candidate = value as { toNumber?: () => number; low?: number; high?: number };
        if (typeof candidate.toNumber === "function") {
            const numeric = candidate.toNumber();
            return Number.isFinite(numeric) ? numeric : 0;
        }
        if (typeof candidate.low === "number" && typeof candidate.high === "number") {
            return candidate.high * 0x100000000 + (candidate.low >>> 0);
        }
    }
    return 0;
}

export function buildAgentEnvelope(
    event: Record<string, any>,
    userId: string,
    fallbackSessionId?: string,
): Record<string, unknown> {
    return {
        type: "AGENT_EVENT",
        event: {
            userId,
            sessionId: event.sessionId || fallbackSessionId || "",
            eventType: normalizeEventType(event.type),
            content: event.content ?? "",
            toolCall: event.toolCall ?? null,
            toolResult: event.toolResult ?? null,
            timestamp: toTimestamp(event.timestamp),
            sequence: typeof event.sequence === "number" ? event.sequence : 0,
        },
    };
}

export class AgentSessionManager {
    private clientRPC = clientRPC;

    async SessionCheck({ sessionId, repositoryId, userId, prompt, socket }: AgentCallData): Promise<void> {
        let session: SessionRecord | undefined;

        if (sessionId == undefined) {
            const database = db();
            const [newSession] = await database
                .insert(agentSessions)
                .values({
                    userId,
                    title: prompt.length > 30
                        ? prompt.slice(0, 30) + "..."
                        : prompt,
                    repositoryId: repositoryId ?? null,
                })
                .returning();

            if (!newSession) {
                socket.send(JSON.stringify({ type: "error", message: "Failed to create session" }));
                return;
            }
            session = newSession;

            await cacheData.deleteCache(cacheKeys.userSessionsRecent(userId));
            await cacheData.setCache(cacheKeys.session(newSession.id), newSession, CACHE_TTL.SESSION);
        } else {
            const cacheKey = cacheKeys.session(sessionId);
            const checkSessionCache = (await cacheData.getCache(cacheKey)) as SessionRecord | null;

            if (checkSessionCache && checkSessionCache.userId === userId) {
                session = checkSessionCache;
            } else {
                const database = db();
                const [foundSession] = await database
                    .select()
                    .from(agentSessions)
                    .where(
                        and(
                            eq(agentSessions.id, sessionId),
                            eq(agentSessions.userId, userId),
                        )
                    )
                    .limit(1);
                session = foundSession;

                if (session) {
                    await cacheData.setCache(cacheKey, session, CACHE_TTL.SESSION);
                }
            }
        }

        if (!session) {
            socket.send(JSON.stringify({ type: "error", message: "Session not found" }));
            return;
        }

        await sessionRouter.register(socket, session.id);

        const data: AgentCallData = {
            userId: userId,
            sessionId: session.id,
            repositoryId: session.repositoryId ?? undefined,
            prompt: prompt,
            socket: socket,
        };

        this.CallToAgent(data);
    }

    CallToAgent(data: AgentCallData) {
        this.ClientCall(data)
    }

    ClientCall(data: ClientRpc) {

        const stream = (this.clientRPC as any).runAgent({
            sessionId: data.sessionId,
            userId: data.userId,
            prompt: data.prompt,
            repositoryId: data.repositoryId
        })

        stream.on("data", (event: any) => {
            const sessionId = event.sessionId || data.sessionId || "";
            const envelope = buildAgentEnvelope(event, data.userId, data.sessionId);
            sessionRouter.publish(sessionId, envelope).catch((error) => {
                console.error("Failed to publish agent event:", error);
            });
        });

        stream.on("end", () => {
            console.log(`Agent stream ended for session ${data.sessionId}`);
        });

        stream.on("error", (error: any) => {
            console.error("Stream error:", error);
            safeSend(data.socket, JSON.stringify({ type: "error", message: "Agent stream failed" }));
        });
    }
}
