export const CACHE_TTL = {
    SESSION: 86400,
    USER_SESSIONS_RECENT: 300,
} as const;

export const cacheKeys = {
    session: (sessionId: string) => `session:${sessionId}`,
    userSessionsRecent: (userId: string) => `user:${userId}:sessions:recent`,
};