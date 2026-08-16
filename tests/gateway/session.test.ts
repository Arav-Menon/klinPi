import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import app from "../../packages/gateway/src/app.js";
import { prisma } from "../../packages/gateway/src/lib/prisma.js";
import { cacheData } from "../../packages/gateway/src/lib/cache.js";
import { cacheKeys } from "../../packages/gateway/src/lib/cacheKey.js";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "test-secret";

function createToken(userId: string) {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: "15m" });
}

describe("Session Management", () => {
  let testUserId: string;
  let authToken: string;

  beforeEach(async () => {
    const user = await prisma().user.create({
      data: {
        email: `test-${Date.now()}@example.com`,
        passwordHash: "hashed-password",
        name: "Test User",
      },
    });
    testUserId = user.id;
    authToken = createToken(testUserId);
  });

  afterEach(async () => {
    await prisma().agentSession.deleteMany({ where: { userId: testUserId } });
    await prisma().user.delete({ where: { id: testUserId } });
    await cacheData.deleteByPattern(`user:${testUserId}:*`);
  });

  describe("POST /api/v1/sessions", () => {
    it("should create a session for authenticated user", async () => {
      const res = await request(app)
        .post("/api/v1/sessions")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ title: "Test Session" });

      expect(res.status).toBe(201);
      expect(res.body.session).toBeDefined();
      expect(res.body.session.title).toBe("Test Session");
      expect(res.body.session.userId).toBe(testUserId);
      expect(res.body.session.status).toBe("ACTIVE");
    });

    it("should return 401 for unauthenticated user", async () => {
      const res = await request(app)
        .post("/api/v1/sessions")
        .send({ title: "Test Session" });

      expect(res.status).toBe(401);
    });

    it("should persist session in PostgreSQL", async () => {
      const res = await request(app)
        .post("/api/v1/sessions")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ title: "Persist Test" });

      const session = await prisma().agentSession.findUnique({
        where: { id: res.body.session.id },
      });

      expect(session).toBeDefined();
      expect(session?.title).toBe("Persist Test");
    });

    it("should invalidate recent sessions cache on create", async () => {
      await cacheData.setCache(cacheKeys.userSessionsRecent(testUserId), { sessions: [] });

      await request(app)
        .post("/api/v1/sessions")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ title: "Cache Test" });

      const cached = await cacheData.getCache(cacheKeys.userSessionsRecent(testUserId));
      expect(cached).toBeNull();
    });
  });

  describe("GET /api/v1/sessions/:sessionId", () => {
    it("should return session from cache on cache hit", async () => {
      const createRes = await request(app)
        .post("/api/v1/sessions")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ title: "Cache Hit Test" });

      const sessionId = createRes.body.session.id;

      await cacheData.setCache(cacheKeys.session(sessionId), createRes.body.session);

      const res = await request(app)
        .get(`/api/v1/sessions/${sessionId}`)
        .set("Authorization", `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.session.id).toBe(sessionId);
    });

    it("should fetch from PostgreSQL on cache miss", async () => {
      const createRes = await request(app)
        .post("/api/v1/sessions")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ title: "Cache Miss Test" });

      const sessionId = createRes.body.session.id;

      const res = await request(app)
        .get(`/api/v1/sessions/${sessionId}`)
        .set("Authorization", `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.session.id).toBe(sessionId);
    });

    it("should cache fetched session", async () => {
      const createRes = await request(app)
        .post("/api/v1/sessions")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ title: "Cache Store Test" });

      const sessionId = createRes.body.session.id;

      await request(app)
        .get(`/api/v1/sessions/${sessionId}`)
        .set("Authorization", `Bearer ${authToken}`);

      const cached = await cacheData.getCache(cacheKeys.session(sessionId));
      expect(cached).toBeDefined();
    });

    it("should not allow user to access another user session", async () => {
      const otherUser = await prisma().user.create({
        data: {
          email: `other-${Date.now()}@example.com`,
          passwordHash: "hashed-password",
        },
      });

      const createRes = await request(app)
        .post("/api/v1/sessions")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ title: "Owner Test" });

      const otherToken = createToken(otherUser.id);
      const res = await request(app)
        .get(`/api/v1/sessions/${createRes.body.session.id}`)
        .set("Authorization", `Bearer ${otherToken}`);

      expect(res.status).toBe(404);

      await prisma().user.delete({ where: { id: otherUser.id } });
    });
  });

  describe("PATCH /api/v1/sessions/:sessionId", () => {
    it("should update session and invalidate caches", async () => {
      const createRes = await request(app)
        .post("/api/v1/sessions")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ title: "Original Title" });

      const sessionId = createRes.body.session.id;
      await cacheData.setCache(cacheKeys.session(sessionId), createRes.body.session);
      await cacheData.setCache(cacheKeys.userSessionsRecent(testUserId), { sessions: [] });

      const res = await request(app)
        .patch(`/api/v1/sessions/${sessionId}`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({ title: "Updated Title" });

      expect(res.status).toBe(200);
      expect(res.body.session.title).toBe("Updated Title");

      const sessionCache = await cacheData.getCache(cacheKeys.session(sessionId));
      expect(sessionCache).toBeNull();

      const recentCache = await cacheData.getCache(cacheKeys.userSessionsRecent(testUserId));
      expect(recentCache).toBeNull();
    });

    it("should return 404 for non-existent session", async () => {
      const res = await request(app)
        .patch("/api/v1/sessions/non-existent-id")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ title: "Updated" });

      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /api/v1/sessions/:sessionId", () => {
    it("should archive session and clear caches", async () => {
      const createRes = await request(app)
        .post("/api/v1/sessions")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ title: "Archive Test" });

      const sessionId = createRes.body.session.id;

      const res = await request(app)
        .delete(`/api/v1/sessions/${sessionId}`)
        .set("Authorization", `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("Session archived successfully");

      const session = await prisma().agentSession.findUnique({
        where: { id: sessionId },
      });
      expect(session?.status).toBe("ARCHIVED");
    });

    it("should return 400 if session already archived", async () => {
      const createRes = await request(app)
        .post("/api/v1/sessions")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ title: "Already Archived" });

      const sessionId = createRes.body.session.id;

      await request(app)
        .delete(`/api/v1/sessions/${sessionId}`)
        .set("Authorization", `Bearer ${authToken}`);

      const res = await request(app)
        .delete(`/api/v1/sessions/${sessionId}`)
        .set("Authorization", `Bearer ${authToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Session is already archived");
    });

    it("should not show archived sessions in recent", async () => {
      const createRes = await request(app)
        .post("/api/v1/sessions")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ title: "Archive Recent Test" });

      const sessionId = createRes.body.session.id;

      await request(app)
        .delete(`/api/v1/sessions/${sessionId}`)
        .set("Authorization", `Bearer ${authToken}`);

      const res = await request(app)
        .get("/api/v1/sessions/recent")
        .set("Authorization", `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      const found = res.body.sessions.find((s: { id: string }) => s.id === sessionId);
      expect(found).toBeUndefined();
    });
  });

  describe("GET /api/v1/sessions/recent", () => {
    it("should return only user sessions", async () => {
      await request(app)
        .post("/api/v1/sessions")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ title: "Session 1" });

      await request(app)
        .post("/api/v1/sessions")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ title: "Session 2" });

      const res = await request(app)
        .get("/api/v1/sessions/recent")
        .set("Authorization", `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.sessions).toHaveLength(2);
      expect(res.body.sessions.every((s: { userId: string }) => s.userId === testUserId)).toBe(true);
    });

    it("should exclude archived sessions", async () => {
      const createRes = await request(app)
        .post("/api/v1/sessions")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ title: "Will Archive" });

      await request(app)
        .delete(`/api/v1/sessions/${createRes.body.session.id}`)
        .set("Authorization", `Bearer ${authToken}`);

      const res = await request(app)
        .get("/api/v1/sessions/recent")
        .set("Authorization", `Bearer ${authToken}`);

      expect(res.body.sessions).toHaveLength(0);
    });

    it("should order by updatedAt descending", async () => {
      await request(app)
        .post("/api/v1/sessions")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ title: "First" });

      await new Promise((resolve) => setTimeout(resolve, 10));

      await request(app)
        .post("/api/v1/sessions")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ title: "Second" });

      const res = await request(app)
        .get("/api/v1/sessions/recent")
        .set("Authorization", `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.sessions[0].title).toBe("Second");
      expect(res.body.sessions[1].title).toBe("First");
    });
  });

  describe("GET /api/v1/sessions/search", () => {
    it("should return matching sessions", async () => {
      await request(app)
        .post("/api/v1/sessions")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ title: "TypeScript Project" });

      await request(app)
        .post("/api/v1/sessions")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ title: "JavaScript Project" });

      const res = await request(app)
        .get("/api/v1/sessions/search?q=TypeScript")
        .set("Authorization", `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.sessions).toHaveLength(1);
      expect(res.body.sessions[0].title).toBe("TypeScript Project");
    });

    it("should only search user sessions", async () => {
      const otherUser = await prisma().user.create({
        data: {
          email: `other-search-${Date.now()}@example.com`,
          passwordHash: "hashed-password",
        },
      });

      const otherToken = createToken(otherUser.id);

      await request(app)
        .post("/api/v1/sessions")
        .set("Authorization", `Bearer ${otherToken}`)
        .send({ title: "Other User Session" });

      const res = await request(app)
        .get("/api/v1/sessions/search?q=Other")
        .set("Authorization", `Bearer ${authToken}`);

      expect(res.body.sessions).toHaveLength(0);

      await prisma().agentSession.deleteMany({ where: { userId: otherUser.id } });
      await prisma().user.delete({ where: { id: otherUser.id } });
    });

    it("should exclude archived sessions from search", async () => {
      const createRes = await request(app)
        .post("/api/v1/sessions")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ title: "Archived Search" });

      await request(app)
        .delete(`/api/v1/sessions/${createRes.body.session.id}`)
        .set("Authorization", `Bearer ${authToken}`);

      const res = await request(app)
        .get("/api/v1/sessions/search?q=Archived")
        .set("Authorization", `Bearer ${authToken}`);

      expect(res.body.sessions).toHaveLength(0);
    });
  });
});
