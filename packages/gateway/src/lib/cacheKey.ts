export const CACHE_TTL = {
    SESSION: 3600,
    USER_SESSIONS_RECENT: 300,
} as const;

export const cacheKeys = {
    userProfile: (userId: string) => `user:profile:${userId}`,
    session: (sessionId: string) => `session:${sessionId}`,
    userSessionsRecent: (userId: string) => `user:${userId}:sessions:recent`,
};
