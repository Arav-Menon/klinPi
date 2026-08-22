import type { WebSocket } from "ws";
import { db } from "../lib/prisma.js";
import { cacheData } from "../lib/cache.js";
import { CACHE_TTL, cacheKeys } from "../lib/redisKeys.js";

export interface AgentCallData {
    userId: string;
    sessionId?: string | undefined;
    repositoryId?: string;
    prompt: string;
    socket: WebSocket;
}

export class AgentSessionManager {
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
        const sessionId = data.sessionId as string;

    }

}
