import { db } from "../../lib/db.js";
import { agentSessions, messages, repositories } from "@klinpi/db/schema";
import { eq, and, ne, desc, gt } from "drizzle-orm";
import { deriveSessionTitle } from "@klinpi/common";
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
  data: { title?: string; repositoryId?: string; prompt?: string },
): Promise<SessionResponse | null> {
  const database = db();

  // A session may only reference a repository the same user owns.
  if (data.repositoryId) {
    const [repo] = await database
      .select({ id: repositories.id })
      .from(repositories)
      .where(and(eq(repositories.id, data.repositoryId), eq(repositories.userId, userId)))
      .limit(1);
    if (!repo) return null;
  }

  const title = data.title ?? (data.prompt ? deriveSessionTitle(data.prompt) : null);

  // Session and its initial USER message are persisted atomically so a
  // created session is never missing its first message.
  const session = await database.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(agentSessions)
      .values({
        userId,
        title,
        repositoryId: data.repositoryId ?? null,
      })
      .returning(SESSION_COLUMNS);

    if (data.prompt) {
      await tx.insert(messages).values({
        sessionId: inserted!.id,
        role: "USER",
        content: data.prompt,
      });
    }

    return inserted!;
  });

  await cacheData.deleteCache(cacheKeys.userSessionsRecent(userId));
  await cacheData.setCache(cacheKeys.session(session.id), session, CACHE_TTL.SESSION);

  return session as SessionResponse;
}

export type MessageResponse = {
  id: string;
  role: string;
  content: string;
  metadata: unknown;
  createdAt: Date;
};

/**
 * Persisted conversation history for a session, oldest first.
 * Returns null when the session does not exist or is not owned by
 * `userId` (callers map that to a 404 — never leak other users' data).
 */
export async function getSessionMessages(
  userId: string,
  sessionId: string,
  limit: number,
): Promise<MessageResponse[] | null> {
  const session = await getSession(userId, sessionId);
  if (!session) return null;

  const database = db();
  const rows = await database
    .select({
      id: messages.id,
      role: messages.role,
      content: messages.content,
      metadata: messages.metadata,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(desc(messages.createdAt))
    .limit(limit);

  return rows.reverse();
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

export type UpdateSessionResult =
  | SessionResponse
  | "REPOSITORY_LOCKED"
  | "REPOSITORY_INVALID"
  | null;

export async function updateSession(
  userId: string,
  sessionId: string,
  data: { title?: string; status?: SessionStatus; repositoryId?: string },
): Promise<UpdateSessionResult> {
  const database = db();

  const [existing] = await database
    .select({ userId: agentSessions.userId, repositoryId: agentSessions.repositoryId })
    .from(agentSessions)
    .where(eq(agentSessions.id, sessionId))
    .limit(1);

  if (!existing || existing.userId !== userId) {
    return null;
  }

  // One repository per session: once bound, it can never be changed.
  if (data.repositoryId !== undefined) {
    if (existing.repositoryId) {
      return "REPOSITORY_LOCKED";
    }
    const [repo] = await database
      .select({ id: repositories.id })
      .from(repositories)
      .where(and(eq(repositories.id, data.repositoryId), eq(repositories.userId, userId)))
      .limit(1);
    if (!repo) {
      return "REPOSITORY_INVALID";
    }
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
    .orderBy(desc(agentSessions.updatedAt))
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
