import { db } from "../../lib/db.js";
import { agentSessions } from "@klinpi/db/schema";
import { eq, and, ne, desc, gt } from "drizzle-orm";
import { cacheData } from "../../lib/cache.js";
import { cacheKeys, CACHE_TTL } from "../../lib/cacheKey.js";
import type { SessionStatus } from "@klinpi/db";

const SESSION_COLUMNS = {
  id: agentSessions.id,
  userId: agentSessions.userId,
  repositoryId: agentSessions.repositoryId,
  title: agentSessions.title,
  status: agentSessions.status,
  createdAt: agentSessions.createdAt,
  updatedAt: agentSessions.updatedAt,
} as const;

type SessionResponse = {
  id: string;
  userId: string;
  repositoryId: string | null;
  title: string | null;
  status: SessionStatus;
  createdAt: Date;
  updatedAt: Date;
};

export async function createSession(
  userId: string,
  data: { title?: string; repositoryId?: string },
): Promise<SessionResponse> {
  const database = db();
  const [session] = await database
    .insert(agentSessions)
    .values({
      userId,
      title: data.title ?? null,
      repositoryId: data.repositoryId ?? null,
    })
    .returning(SESSION_COLUMNS);

  await cacheData.deleteCache(cacheKeys.userSessionsRecent(userId));
  await cacheData.setCache(cacheKeys.session(session!.id), session, CACHE_TTL.SESSION);

  return session as SessionResponse;
}

export async function getSession(
  userId: string,
  sessionId: string,
): Promise<SessionResponse | null> {
  const database = db();
  const cacheKey = cacheKeys.session(sessionId);

  const cached = await cacheData.getCache(cacheKey);
  if (cached) {
    const session = cached as SessionResponse;
    if (session.userId !== userId) {
      return null;
    }
    return session;
  }

  const [session] = await database
    .select(SESSION_COLUMNS)
    .from(agentSessions)
    .where(eq(agentSessions.id, sessionId))
    .limit(1);

  if (!session || session.userId !== userId) {
    return null;
  }

  await cacheData.setCache(cacheKey, session, CACHE_TTL.SESSION);
  return session as SessionResponse;
}

export async function updateSession(
  userId: string,
  sessionId: string,
  data: { title?: string; status?: SessionStatus },
): Promise<SessionResponse | null> {
  const database = db();

  const [existing] = await database
    .select({ userId: agentSessions.userId })
    .from(agentSessions)
    .where(eq(agentSessions.id, sessionId))
    .limit(1);

  if (!existing || existing.userId !== userId) {
    return null;
  }

  const [session] = await database
    .update(agentSessions)
    .set(data)
    .where(eq(agentSessions.id, sessionId))
    .returning(SESSION_COLUMNS);

  await cacheData.deleteCache(cacheKeys.session(sessionId));
  await cacheData.deleteCache(cacheKeys.userSessionsRecent(userId));

  return (session as SessionResponse) ?? null;
}

export async function archiveSession(
  userId: string,
  sessionId: string,
): Promise<SessionResponse | "ALREADY_ARCHIVED" | null> {
  const database = db();

  const [existing] = await database
    .select({ userId: agentSessions.userId, status: agentSessions.status })
    .from(agentSessions)
    .where(eq(agentSessions.id, sessionId))
    .limit(1);

  if (!existing || existing.userId !== userId) {
    return null;
  }

  if (existing.status === "ARCHIVED") {
    return "ALREADY_ARCHIVED";
  }

  const [session] = await database
    .update(agentSessions)
    .set({ status: "ARCHIVED" })
    .where(eq(agentSessions.id, sessionId))
    .returning(SESSION_COLUMNS);

  await cacheData.deleteCache(cacheKeys.session(sessionId));
  await cacheData.deleteCache(cacheKeys.userSessionsRecent(userId));

  return (session as SessionResponse) ?? null;
}

export async function getRecentSessions(
  userId: string,
  limit: number,
  cursor?: string,
): Promise<{ sessions: SessionResponse[]; nextCursor: string | undefined }> {
  const database = db();
  const cacheKey = cacheKeys.userSessionsRecent(userId);

  if (!cursor) {
    const cached = await cacheData.getCache(cacheKey);
    if (cached) {
      return cached as { sessions: SessionResponse[]; nextCursor: string | undefined };
    }
  }

  const conditions = [
    eq(agentSessions.userId, userId),
    ne(agentSessions.status, "ARCHIVED"),
  ];

  if (cursor) {
    conditions.push(gt(agentSessions.id, cursor));
  }

  const sessions = await database
    .select(SESSION_COLUMNS)
    .from(agentSessions)
    .where(and(...conditions))
    .orderBy(agentSessions.updatedAt)
    .limit(limit + 1);

  const hasMore = sessions.length > limit;
  const result = {
    sessions: sessions.slice(0, limit).map((s) => s as SessionResponse),
    nextCursor: hasMore ? sessions[limit - 1]!.id : undefined,
  };

  await cacheData.setCache(cacheKey, result, CACHE_TTL.USER_SESSIONS_RECENT);
  return result;
}

export async function searchSessions(
  userId: string,
  query: string,
  limit: number,
): Promise<SessionResponse[]> {
  const database = db();

  const sessions = await database
    .select(SESSION_COLUMNS)
    .from(agentSessions)
    .where(
      and(
        eq(agentSessions.userId, userId),
        ne(agentSessions.status, "ARCHIVED"),
      )
    )
    .orderBy(agentSessions.updatedAt)
    .limit(limit);

  const lowerQuery = query.toLowerCase();
  return sessions
    .filter((s) => s.title && s.title.toLowerCase().includes(lowerQuery))
    .map((s) => s as SessionResponse);
}
