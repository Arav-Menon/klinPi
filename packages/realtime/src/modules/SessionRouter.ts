import { WebSocket } from "ws";
import { and, eq } from "drizzle-orm";
import { agentSessions } from "@klinpi/db/schema";
import { redisManger } from "../services/redis-manger.js";
import { cacheData } from "../lib/cache.js";
import { db } from "../lib/db.js";
import { channels, cacheKeys, CACHE_TTL } from "../lib/redisKeys.js";

export type Envelope = Record<string, unknown>;

const SUBSCRIBE_TIMEOUT_MS = 2000;
const PUBLISH_TIMEOUT_MS = 2000;

interface SessionRecord {
    id: string;
    userId: string;
    repositoryId: string | null;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`${label} timed out after ${ms}ms`));
        }, ms);
        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (error) => {
                clearTimeout(timer);
                reject(error);
            },
        );
    });
}

export function safeSend(socket: WebSocket, payload: string): void {
    if (socket.readyState !== WebSocket.OPEN) return;
    try {
        socket.send(payload);
    } catch (error) {
        console.error("WebSocket send failed:", error);
    }
}

class SessionRouter {
    private sessionSockets = new Map<string, Set<WebSocket>>();
    private socketSessions = new Map<WebSocket, Set<string>>();
    private redisCallbacks = new Map<string, (channel: string, message: string) => void>();
    private degraded = new Set<string>();

    async subscribe(socket: WebSocket, sessionId: string, userId: string): Promise<void> {
        const authorized = await this.assertOwnership(sessionId, userId);
        if (!authorized) {
            throw new Error("Not authorized for this session");
        }
        await this.register(socket, sessionId);
    }

    async register(socket: WebSocket, sessionId: string): Promise<void> {
        let sockets = this.sessionSockets.get(sessionId);
        const isNewSession = !sockets;
        if (!sockets) {
            sockets = new Set<WebSocket>();
            this.sessionSockets.set(sessionId, sockets);
        }
        sockets.add(socket);

        let sessions = this.socketSessions.get(socket);
        if (!sessions) {
            sessions = new Set<string>();
            this.socketSessions.set(socket, sessions);
        }
        sessions.add(sessionId);

        if (isNewSession) {
            const channel = channels.agentSession(sessionId);
            const callback = (_channel: string, message: string) => {
                try {
                    const envelope = JSON.parse(message) as Envelope;
                    this.deliverLocal(sessionId, envelope);
                } catch (error) {
                    console.error(`Failed to process redis message for session ${sessionId}:`, error);
                }
            };
            this.redisCallbacks.set(sessionId, callback);
            try {
                await withTimeout(redisManger.subscribe(channel, callback), SUBSCRIBE_TIMEOUT_MS, "Redis subscribe");
            } catch (error) {
                this.degraded.add(sessionId);
                console.error(
                    `Redis subscribe failed for session ${sessionId}, falling back to local delivery:`,
                    error,
                );
            }
        }
    }

    async publish(sessionId: string, envelope: Envelope): Promise<void> {
        if (this.degraded.has(sessionId)) {
            this.deliverLocal(sessionId, envelope);
            return;
        }
        const channel = channels.agentSession(sessionId);
        try {
            await withTimeout(
                redisManger.publish(channel, JSON.stringify(envelope)),
                PUBLISH_TIMEOUT_MS,
                "Redis publish",
            );
        } catch (error) {
            this.degraded.add(sessionId);
            console.error(
                `Redis publish failed for session ${sessionId}, falling back to local delivery:`,
                error,
            );
            this.deliverLocal(sessionId, envelope);
        }
    }

    unsubscribeAll(socket: WebSocket): void {
        const sessionIds = this.socketSessions.get(socket);
        if (!sessionIds) return;
        this.socketSessions.delete(socket);

        for (const sessionId of sessionIds) {
            const sockets = this.sessionSockets.get(sessionId);
            if (!sockets) continue;
            sockets.delete(socket);

            if (sockets.size === 0) {
                this.sessionSockets.delete(sessionId);
                const callback = this.redisCallbacks.get(sessionId);
                this.redisCallbacks.delete(sessionId);
                this.degraded.delete(sessionId);
                if (callback) {
                    redisManger.unsubscribe(channels.agentSession(sessionId), callback).catch((error) => {
                        console.error(`Redis unsubscribe failed for session ${sessionId}:`, error);
                    });
                }
            }
        }
    }

    private deliverLocal(sessionId: string, envelope: Envelope): void {
        const sockets = this.sessionSockets.get(sessionId);
        if (!sockets || sockets.size === 0) return;
        const payload = JSON.stringify(envelope);
        for (const socket of sockets) {
            safeSend(socket, payload);
        }
    }

    private async assertOwnership(sessionId: string, userId: string): Promise<boolean> {
        try {
            const cached = (await cacheData.getCache(cacheKeys.session(sessionId))) as SessionRecord | null;
            if (cached && cached.userId === userId) return true;

            const database = db();
            const [found] = await database
                .select()
                .from(agentSessions)
                .where(and(eq(agentSessions.id, sessionId), eq(agentSessions.userId, userId)))
                .limit(1);
            if (!found) return false;

            await cacheData.setCache(cacheKeys.session(sessionId), found, CACHE_TTL.SESSION);
            return true;
        } catch (error) {
            console.error(`Session ownership check failed for session ${sessionId}:`, error);
            return false;
        }
    }
}

export const sessionRouter = new SessionRouter();
