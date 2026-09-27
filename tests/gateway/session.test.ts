import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../../packages/gateway/src/app";
import { db } from "../../packages/gateway/src/lib/db";
import { messages, users } from "@klinpi/db/schema";
import { inArray } from "drizzle-orm";

const EMAILS = ["session-owner@test.com", "session-other@test.com"];

async function cleanup() {
  // AgentSession and Message rows cascade from the user (onDelete: "cascade").
  await db().delete(users).where(inArray(users.email, EMAILS));
}

function newClient() {
  return request.agent(app);
}

describe("Session API", () => {
  const owner = newClient();
  const other = newClient();

  beforeAll(async () => {
    await cleanup();
    for (const client of [owner, other]) {
      const res = await client.post("/api/v1/auth/signup").send({
        name: "Session Tester",
        email: EMAILS[[owner, other].indexOf(client)],
        password: "password123",
      });
      expect(res.status).toBe(201);
    }
  });

  afterAll(async () => {
    await cleanup();
  });

  describe("POST /api/v1/sessions", () => {
    it("creates a session with a derived title and persists the initial USER message", async () => {
      const prompt = "Fix the flaky auth test and summarize the root cause";

      const res = await owner.post("/api/v1/sessions").send({ prompt });

      expect(res.status).toBe(201);
      const session = res.body.session;
      expect(session.id).toBeTruthy();
      expect(session.userId).toBeTruthy();
      expect(session.repositoryId).toBeNull();
      expect(session.status).toBe("ACTIVE");
      expect(session.title).toBeTruthy();

      const msgs = await owner.get(`/api/v1/sessions/${session.id}/messages`);
      expect(msgs.status).toBe(200);
      expect(msgs.body.messages).toHaveLength(1);
      expect(msgs.body.messages[0]).toMatchObject({ role: "USER", content: prompt });
    });

    it("creates a session without a message when no prompt is given", async () => {
      const res = await owner.post("/api/v1/sessions").send({ title: "Manual title" });

      expect(res.status).toBe(201);
      expect(res.body.session.title).toBe("Manual title");

      const msgs = await owner.get(`/api/v1/sessions/${res.body.session.id}/messages`);
      expect(msgs.status).toBe(200);
      expect(msgs.body.messages).toHaveLength(0);
    });

    it("rejects an empty prompt", async () => {
      const res = await owner.post("/api/v1/sessions").send({ prompt: "" });
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
    });

    it("rejects a repository the user does not own", async () => {
      const res = await owner
        .post("/api/v1/sessions")
        .send({ prompt: "hello", repositoryId: "00000000-0000-0000-0000-000000000000" });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "Repository not found" });
    });

    it("requires authentication", async () => {
      const res = await request(app).post("/api/v1/sessions").send({ prompt: "hello" });
      expect(res.status).toBe(401);
    });
  });

  describe("GET /api/v1/sessions/recent", () => {
    it("returns the user's sessions ordered by most recent activity", async () => {
      const first = await owner.post("/api/v1/sessions").send({ prompt: "First recent probe" });
      expect(first.status).toBe(201);
      await new Promise((resolve) => setTimeout(resolve, 25));
      const second = await owner.post("/api/v1/sessions").send({ prompt: "Second recent probe" });
      expect(second.status).toBe(201);

      const res = await owner.get("/api/v1/sessions/recent");
      expect(res.status).toBe(200);
      const ids: string[] = res.body.sessions.map((s: { id: string }) => s.id);
      const firstIdx = ids.indexOf(first.body.session.id);
      const secondIdx = ids.indexOf(second.body.session.id);
      expect(firstIdx).toBeGreaterThanOrEqual(0);
      expect(secondIdx).toBeGreaterThanOrEqual(0);
      expect(secondIdx).toBeLessThan(firstIdx);
    });

    it("does not leak other users' sessions", async () => {
      const mine = await other.post("/api/v1/sessions").send({ prompt: "Private other session" });
      expect(mine.status).toBe(201);

      const res = await owner.get("/api/v1/sessions/recent");
      expect(res.status).toBe(200);
      const ids: string[] = res.body.sessions.map((s: { id: string }) => s.id);
      expect(ids).not.toContain(mine.body.session.id);
    });

    it("requires authentication", async () => {
      const res = await request(app).get("/api/v1/sessions/recent");
      expect(res.status).toBe(401);
    });
  });

  describe("GET /api/v1/sessions/:sessionId", () => {
    it("returns an owned session", async () => {
      const created = await owner.post("/api/v1/sessions").send({ prompt: "Fetch me" });
      expect(created.status).toBe(201);

      const res = await owner.get(`/api/v1/sessions/${created.body.session.id}`);
      expect(res.status).toBe(200);
      expect(res.body.session.id).toBe(created.body.session.id);
    });

    it("returns 404 for another user's session", async () => {
      const created = await other.post("/api/v1/sessions").send({ prompt: "Other's session" });
      expect(created.status).toBe(201);

      const res = await owner.get(`/api/v1/sessions/${created.body.session.id}`);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Session not found" });
    });

    it("requires authentication", async () => {
      const res = await request(app).get("/api/v1/sessions/some-id");
      expect(res.status).toBe(401);
    });
  });

  describe("GET /api/v1/sessions/:sessionId/messages", () => {
    it("returns messages oldest-first", async () => {
      const created = await owner
        .post("/api/v1/sessions")
        .send({ prompt: "Order probe prompt" });
      expect(created.status).toBe(201);
      const sessionId = created.body.session.id as string;

      await db()
        .insert(messages)
        .values({
          sessionId,
          role: "ASSISTANT",
          content: "Order probe answer",
          createdAt: new Date(Date.now() + 25),
        });

      const res = await owner.get(`/api/v1/sessions/${sessionId}/messages`);
      expect(res.status).toBe(200);
      const rows = res.body.messages as { role: string; content: string }[];
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({ role: "USER", content: "Order probe prompt" });
      expect(rows[1]).toMatchObject({ role: "ASSISTANT", content: "Order probe answer" });
    });

    it("returns 404 for another user's session", async () => {
      const created = await other
        .post("/api/v1/sessions")
        .send({ prompt: "Private messages" });
      expect(created.status).toBe(201);

      const res = await owner.get(`/api/v1/sessions/${created.body.session.id}/messages`);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Session not found" });
    });

    it("rejects an out-of-range limit", async () => {
      const created = await owner.post("/api/v1/sessions").send({ prompt: "Limit probe" });
      expect(created.status).toBe(201);

      const res = await owner
        .get(`/api/v1/sessions/${created.body.session.id}/messages?limit=0`);
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
    });

    it("requires authentication", async () => {
      const res = await request(app).get("/api/v1/sessions/some-id/messages");
      expect(res.status).toBe(401);
    });
  });

  describe("GET /api/v1/auth/ws-token", () => {
    it("mints a JWT for the authenticated user", async () => {
      const res = await owner.get("/api/v1/auth/ws-token");
      expect(res.status).toBe(200);
      expect(typeof res.body.token).toBe("string");
      expect(res.body.token.length).toBeGreaterThan(0);
    });

    it("requires authentication", async () => {
      const res = await request(app).get("/api/v1/auth/ws-token");
      expect(res.status).toBe(401);
    });
  });
});
