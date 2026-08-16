import { prisma } from "../../lib/prisma.js";
import { cacheData } from "../../lib/cache.js";
import { cacheKeys, CACHE_TTL } from "../../lib/cacheKey.js";
import type { SessionStatus } from "@klinpi/prisma";

const SESSION_SELECT = {
  id: true,
  userId: true,
  repositoryId: true,
  title: true,
  status: true,
  createdAt: true,
  updatedAt: true,
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
  const db = prisma();
  const session = await db.agentSession.create({
    data: {
      userId,
      title: data.title ?? null,
      repositoryId: data.repositoryId ?? null,
    },
    select: SESSION_SELECT,
  });

  await cacheData.deleteCache(cacheKeys.userSessionsRecent(userId));
  await cacheData.setCache(cacheKeys.session(session.id), session, CACHE_TTL.SESSION);

  return session as SessionResponse;
}

export async function getSession(
  userId: string,
  sessionId: string,
): Promise<SessionResponse | null> {
  const db = prisma();
  const cacheKey = cacheKeys.session(sessionId);

  const cached = await cacheData.getCache(cacheKey);
  if (cached) {
    const session = cached as SessionResponse;
    if (session.userId !== userId) {
      return null;
    }
    return session;
  }

  const session = await db.agentSession.findUnique({
    where: { id: sessionId },
    select: SESSION_SELECT,
  });

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
  const db = prisma();

  const existing = await db.agentSession.findUnique({
    where: { id: sessionId },
    select: { userId: true },
  });

  if (!existing || existing.userId !== userId) {
    return null;
  }

  const session = await db.agentSession.update({
    where: { id: sessionId },
    data,
    select: SESSION_SELECT,
  });

  await cacheData.deleteCache(cacheKeys.session(sessionId));
  await cacheData.deleteCache(cacheKeys.userSessionsRecent(userId));

  return session as SessionResponse;
}

export async function archiveSession(
  userId: string,
  sessionId: string,
): Promise<SessionResponse | "ALREADY_ARCHIVED" | null> {
  const db = prisma();

  const existing = await db.agentSession.findUnique({
    where: { id: sessionId },
    select: { userId: true, status: true },
  });

  if (!existing || existing.userId !== userId) {
    return null;
  }

  if (existing.status === "ARCHIVED") {
    return "ALREADY_ARCHIVED";
  }

  const session = await db.agentSession.update({
    where: { id: sessionId },
    data: { status: "ARCHIVED" },
    select: SESSION_SELECT,
  });

  await cacheData.deleteCache(cacheKeys.session(sessionId));
  await cacheData.deleteCache(cacheKeys.userSessionsRecent(userId));

  return session as SessionResponse;
}

export async function getRecentSessions(
  userId: string,
  limit: number,
  cursor?: string,
): Promise<{ sessions: SessionResponse[]; nextCursor: string | undefined }> {
  const db = prisma();
  const cacheKey = cacheKeys.userSessionsRecent(userId);

  if (!cursor) {
    const cached = await cacheData.getCache(cacheKey);
    if (cached) {
      return cached as { sessions: SessionResponse[]; nextCursor: string | undefined };
    }
  }

  const sessions = await db.agentSession.findMany({
    where: {
      userId,
      status: { not: "ARCHIVED" },
    },
    select: SESSION_SELECT,
    orderBy: { updatedAt: "desc" },
    take: limit + 1,
    ...(cursor
      ? {
        cursor: { id: cursor },
        skip: 1,
      }
      : {}),
  });

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
  const db = prisma();

  const sessions = await db.agentSession.findMany({
    where: {
      userId,
      status: { not: "ARCHIVED" },
      title: { contains: query, mode: "insensitive" },
    },
    select: SESSION_SELECT,
    orderBy: { updatedAt: "desc" },
    take: limit,
  });

  return sessions.map((s) => s as SessionResponse);
}
