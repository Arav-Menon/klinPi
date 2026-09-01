import type { WebSocket } from "ws";
import { db } from "../lib/prisma.js";
import { cacheData } from "../lib/cache.js";
import { CACHE_TTL, cacheKeys } from "../lib/redisKeys.js";
import { clientRPC } from "../services/client-RPC/rpc-client.js";

export interface AgentCallData extends ClientRpc {
    repositoryId?: string;
    socket: WebSocket;
}

interface ClientRpc {
    userId: string;
    sessionId?: string | undefined;
    prompt: string;
    socket: WebSocket;
    repositoryId?: string;
}

export class AgentSessionManager {
    private clientRPC = clientRPC;

    async SessionCheck({ sessionId, repositoryId, userId, prompt, socket }: AgentCallData): Promise<void> {
        let session;

        if (sessionId == undefined) {

            session = await db.agentSession.create({
                data: {
                    userId,
                    title: prompt.length > 30
                        ? prompt.slice(0, 30) + "..."
                        : prompt,
                    repositoryId: repositoryId ?? null
                }
            });

            await cacheData.deleteCache(cacheKeys.userSessionsRecent(userId));
            await cacheData.setCache(cacheKeys.session(session.id), session, CACHE_TTL.SESSION);
        } else {
            const cacheKey = cacheKeys.session(sessionId);
            const checkSessionCache = await cacheData.getCache(cacheKey);

            if (checkSessionCache && checkSessionCache.userId === userId) {
                session = checkSessionCache;
            } else {
                session = await db.agentSession.findFirst({
                    where: {
                        id: sessionId,
                        repositoryId: repositoryId as string,
                        userId
                    }
                });

                if (session) {
                    await cacheData.setCache(cacheKey, session, CACHE_TTL.SESSION);
                }
            }
        }

        if (!session) {
            socket.send(JSON.stringify({ type: "error", message: "Session not found" }));
            return;
        }

        const data: AgentCallData = {
            userId: userId,
            sessionId: session.id,
            repositoryId: session.repositoryId,
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
            console.log(event)
            data.socket.send(JSON.stringify({
                type: "AGENT_EVENT",
                event: {
                    sessionId: event.sessionId,
                    eventType: event.type,
                    content: event.content,
                    toolCall: event.toolCall,
                    toolResult: event.toolResult,
                }

            }))
        })

        stream.on("end", () => {
            console.log("AGENT_COMPLETED")
            data.socket.send(JSON.stringify({ type: "AGENT_COMPLETED" }))
        });

        stream.on("error", (error: any) => {
            console.error("Stream error:", error);
        });
    }
}
