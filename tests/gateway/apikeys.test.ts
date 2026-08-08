import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import crypto from "crypto";
import { prisma } from "../../packages/gateway/dist/lib/prisma.js";

const app = (await import("../../packages/gateway/dist/app.js")).default;

const BASE = "/api/v1";
const KEY_BASE = `${BASE}/keys`;
const AUTH_BASE = `${BASE}/auth`;
const AGENT_BASE = `${BASE}/agent`;

async function cleanupTestData() {
  const db = prisma();
  await db.apiKey.deleteMany({ where: { user: { email: { contains: "apitest" } } } });
  await db.user.deleteMany({ where: { email: { contains: "apitest" } } });
}

async function createUser(email = "apitest-user1@test.com") {
  const res = await request(app)
    .post(`${AUTH_BASE}/signup`)
    .send({ name: "Test User", email, password: "password123" });
  return res;
}

function extractCookie(res: request.Response): string {
  const cookies = res.headers["set-cookie"];
  if (!cookies) return "";
  if (Array.isArray(cookies)) {
    return cookies.map((c) => c.split(";")[0]).join("; ");
  }
  return cookies.split(";")[0];
}

describe("API Key Management", () => {
  let user1Cookie: string;
  let user2Cookie: string;
  let user1Id: string;
  let user2Id: string;

  beforeAll(async () => {
    await cleanupTestData();

    const u1 = await createUser("apitest-user1@test.com");
    user1Cookie = extractCookie(u1);
    user1Id = u1.body.user.id;

    const u2 = await createUser("apitest-user2@test.com");
    user2Cookie = extractCookie(u2);
    user2Id = u2.body.user.id;
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma().$disconnect();
  });

  describe("POST /api/v1/keys — Create API Key", () => {
    it("should create an API key for an authenticated user", async () => {
      const res = await request(app)
        .post(KEY_BASE)
        .set("Cookie", user1Cookie)
        .send({ name: "OpenCode" })
        .expect(201);

      expect(res.body).toMatchObject({
        name: "OpenCode",
        keyPrefix: expect.stringMatching(/^kp_live_/),
        key: expect.stringMatching(/^kp_live_/),
      });
      expect(res.body.id).toBeDefined();
      expect(res.body.createdAt).toBeDefined();
    });

    it("should return the raw key exactly once (on creation only)", async () => {
      const createRes = await request(app)
        .post(KEY_BASE)
        .set("Cookie", user1Cookie)
        .send({ name: "OneTimeKey" })
        .expect(201);

      expect(createRes.body.key).toBeDefined();
      expect(createRes.body.key.length).toBeGreaterThan(10);

      const listRes = await request(app)
        .get(KEY_BASE)
        .set("Cookie", user1Cookie)
        .expect(200);

      for (const k of listRes.body) {
        expect(k.key).toBeUndefined();
        expect(k.keyHash).toBeUndefined();
      }
    });

    it("should NOT store the raw key in the database", async () => {
      const createRes = await request(app)
        .post(KEY_BASE)
        .set("Cookie", user1Cookie)
        .send({ name: "NoRawKey" })
        .expect(201);

      const db = prisma();
      const keyRecord = await db.apiKey.findUnique({
        where: { id: createRes.body.id },
      });

      expect(keyRecord).not.toBeNull();
      expect(keyRecord!.keyHash).toBeDefined();
      expect(keyRecord!.keyHash).not.toBe(createRes.body.key);
      expect(keyRecord!.keyHash.length).toBe(64);
    });

    it("should store the keyPrefix in the database", async () => {
      const createRes = await request(app)
        .post(KEY_BASE)
        .set("Cookie", user1Cookie)
        .send({ name: "PrefixTest" })
        .expect(201);

      const db = prisma();
      const keyRecord = await db.apiKey.findUnique({
        where: { id: createRes.body.id },
      });

      expect(keyRecord).not.toBeNull();
      expect(keyRecord!.keyPrefix).toBe(createRes.body.keyPrefix);
      expect(keyRecord!.keyPrefix).toMatch(/^kp_live_/);
    });

    it("should reject unauthenticated requests", async () => {
      await request(app)
        .post(KEY_BASE)
        .send({ name: "Unauthed" })
        .expect(401);
    });

    it("should reject requests with invalid JWT", async () => {
      await request(app)
        .post(KEY_BASE)
        .set("Cookie", "klinpi_token=invalid-token-here")
        .send({ name: "BadJWT" })
        .expect(401);
    });

    it("should reject requests with empty name", async () => {
      await request(app)
        .post(KEY_BASE)
        .set("Cookie", user1Cookie)
        .send({ name: "" })
        .expect(400);
    });

    it("should reject requests without name", async () => {
      await request(app)
        .post(KEY_BASE)
        .set("Cookie", user1Cookie)
        .send({})
        .expect(400);
    });
  });

  describe("GET /api/v1/keys — List API Keys", () => {
    it("should list API keys for the authenticated user", async () => {
      const res = await request(app)
        .get(KEY_BASE)
        .set("Cookie", user1Cookie)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
    });

    it("should return only safe metadata, never raw keys or hashes", async () => {
      const res = await request(app)
        .get(KEY_BASE)
        .set("Cookie", user1Cookie)
        .expect(200);

      for (const k of res.body) {
        expect(k.key).toBeUndefined();
        expect(k.keyHash).toBeUndefined();
        expect(k.secret).toBeUndefined();
        expect(k.id).toBeDefined();
        expect(k.name).toBeDefined();
        expect(k.keyPrefix).toBeDefined();
        expect(k.enabled).toBeDefined();
        expect(k.createdAt).toBeDefined();
      }
    });

    it("should only return keys belonging to the authenticated user", async () => {
      const res1 = await request(app)
        .get(KEY_BASE)
        .set("Cookie", user1Cookie)
        .expect(200);

      const res2 = await request(app)
        .get(KEY_BASE)
        .set("Cookie", user2Cookie)
        .expect(200);

      const ids1 = res1.body.map((k: { id: string }) => k.id);
      const ids2 = res2.body.map((k: { id: string }) => k.id);
      const overlap = ids1.filter((id: string) => ids2.includes(id));
      expect(overlap).toEqual([]);
    });

    it("should reject unauthenticated requests", async () => {
      await request(app)
        .get(KEY_BASE)
        .expect(401);
    });
  });

  describe("DELETE /api/v1/keys/:id — Revoke API Key", () => {
    it("should revoke a key belonging to the user", async () => {
      const createRes = await request(app)
        .post(KEY_BASE)
        .set("Cookie", user1Cookie)
        .send({ name: "ToRevoke" })
        .expect(201);

      const revokeRes = await request(app)
        .delete(`${KEY_BASE}/${createRes.body.id}`)
        .set("Cookie", user1Cookie)
        .expect(200);

      expect(revokeRes.body.id).toBe(createRes.body.id);
      expect(revokeRes.body.revokedAt).toBeDefined();
    });

    it("should return 404 when revoking a nonexistent key", async () => {
      await request(app)
        .delete(`${KEY_BASE}/nonexistent-id`)
        .set("Cookie", user1Cookie)
        .expect(404);
    });

    it("should NOT allow User A to revoke User B's key", async () => {
      const createRes = await request(app)
        .post(KEY_BASE)
        .set("Cookie", user1Cookie)
        .send({ name: "User1Key" })
        .expect(201);

      await request(app)
        .delete(`${KEY_BASE}/${createRes.body.id}`)
        .set("Cookie", user2Cookie)
        .expect(404);

      const listRes = await request(app)
        .get(KEY_BASE)
        .set("Cookie", user1Cookie)
        .expect(200);

      const key = listRes.body.find((k: { id: string }) => k.id === createRes.body.id);
      expect(key).toBeDefined();
      expect(key.enabled).toBe(true);
      expect(key.revokedAt).toBeNull();
    });

    it("should reject unauthenticated revocation", async () => {
      await request(app)
        .delete(`${KEY_BASE}/some-id`)
        .expect(401);
    });
  });

  describe("API Key Authentication Middleware", () => {
    it("should authenticate a valid API key", async () => {
      const createRes = await request(app)
        .post(KEY_BASE)
        .set("Cookie", user1Cookie)
        .send({ name: "AuthTest" })
        .expect(201);

      const rawKey = createRes.body.key;

      const res = await request(app)
        .get(`${AGENT_BASE}/me`)
        .set("Authorization", `Bearer ${rawKey}`)
        .expect(200);

      expect(res.body.user).toBeDefined();
      expect(res.body.user.id).toBe(user1Id);
    });

    it("should reject an invalid API key", async () => {
      await request(app)
        .get(`${AGENT_BASE}/me`)
        .set("Authorization", "Bearer kp_live_invalidkey1234567890abcdef")
        .expect(401);
    });

    it("should reject a revoked API key", async () => {
      const createRes = await request(app)
        .post(KEY_BASE)
        .set("Cookie", user1Cookie)
        .send({ name: "RevokeAuthTest" })
        .expect(201);

      const rawKey = createRes.body.key;

      await request(app)
        .delete(`${KEY_BASE}/${createRes.body.id}`)
        .set("Cookie", user1Cookie)
        .expect(200);

      await request(app)
        .get(`${AGENT_BASE}/me`)
        .set("Authorization", `Bearer ${rawKey}`)
        .expect(401);
    });

    it("should reject a disabled API key", async () => {
      const createRes = await request(app)
        .post(KEY_BASE)
        .set("Cookie", user1Cookie)
        .send({ name: "DisableAuthTest" })
        .expect(201);

      const rawKey = createRes.body.key;

      await request(app)
        .delete(`${KEY_BASE}/${createRes.body.id}`)
        .set("Cookie", user1Cookie)
        .expect(200);

      await request(app)
        .get(`${AGENT_BASE}/me`)
        .set("Authorization", `Bearer ${rawKey}`)
        .expect(401);
    });

    it("should reject missing Authorization header", async () => {
      await request(app)
        .get(`${AGENT_BASE}/me`)
        .expect(401);
    });

    it("should reject malformed Bearer token (no 'Bearer ' prefix)", async () => {
      const createRes = await request(app)
        .post(KEY_BASE)
        .set("Cookie", user1Cookie)
        .send({ name: "MalformedTest" })
        .expect(201);

      const rawKey = createRes.body.key;

      await request(app)
        .get(`${AGENT_BASE}/me`)
        .set("Authorization", rawKey)
        .expect(401);

      await request(app)
        .get(`${AGENT_BASE}/me`)
        .set("Authorization", `Basic ${rawKey}`)
        .expect(401);
    });

    it("should identify the correct user from API key", async () => {
      const createRes = await request(app)
        .post(KEY_BASE)
        .set("Cookie", user1Cookie)
        .send({ name: "UserIdentTest" })
        .expect(201);

      const rawKey = createRes.body.key;

      const res = await request(app)
        .get(`${AGENT_BASE}/me`)
        .set("Authorization", `Bearer ${rawKey}`)
        .expect(200);

      expect(res.body.user).toBeDefined();
      expect(res.body.user.id).toBe(user1Id);
    });
  });

  describe("lastUsedAt updates", () => {
    it("should update lastUsedAt on first use", async () => {
      const createRes = await request(app)
        .post(KEY_BASE)
        .set("Cookie", user1Cookie)
        .send({ name: "LastUsedTest" })
        .expect(201);

      const rawKey = createRes.body.key;
      const db = prisma();

      let key = await db.apiKey.findUnique({ where: { id: createRes.body.id } });
      expect(key!.lastUsedAt).toBeNull();

      await request(app)
        .get(`${AGENT_BASE}/me`)
        .set("Authorization", `Bearer ${rawKey}`)
        .expect(200);

      key = await db.apiKey.findUnique({ where: { id: createRes.body.id } });
      expect(key!.lastUsedAt).not.toBeNull();
    });

    it("should throttle lastUsedAt updates (within 5min window)", async () => {
      const createRes = await request(app)
        .post(KEY_BASE)
        .set("Cookie", user1Cookie)
        .send({ name: "ThrottleTest" })
        .expect(201);

      const rawKey = createRes.body.key;
      const db = prisma();

      await request(app)
        .get(`${AGENT_BASE}/me`)
        .set("Authorization", `Bearer ${rawKey}`)
        .expect(200);

      const first = await db.apiKey.findUnique({ where: { id: createRes.body.id } });
      const firstUsedAt = first!.lastUsedAt!;

      await new Promise((resolve) => setTimeout(resolve, 100));

      await request(app)
        .get(`${AGENT_BASE}/me`)
        .set("Authorization", `Bearer ${rawKey}`)
        .expect(200);

      const second = await db.apiKey.findUnique({ where: { id: createRes.body.id } });
      expect(second!.lastUsedAt!.getTime()).toBe(firstUsedAt.getTime());
    });
  });

  describe("API Key Generation Security", () => {
    it("should generate keys with cryptographically secure randomness", () => {
      const keys = new Set<string>();
      for (let i = 0; i < 100; i++) {
        const secret = crypto.randomBytes(32).toString("hex");
        const key = `kp_live_${secret}`;
        expect(key).toMatch(/^kp_live_[0-9a-f]{64}$/);
        keys.add(key);
      }
      expect(keys.size).toBe(100);
    });

    it("should produce unique keys", async () => {
      const keys = new Set<string>();
      for (let i = 0; i < 10; i++) {
        const res = await request(app)
          .post(KEY_BASE)
          .set("Cookie", user1Cookie)
          .send({ name: `UniqueTest${i}` })
          .expect(201);
        keys.add(res.body.key);
      }
      expect(keys.size).toBe(10);
    });

    it("should have keyPrefix match the start of the raw key", async () => {
      const createRes = await request(app)
        .post(KEY_BASE)
        .set("Cookie", user1Cookie)
        .send({ name: "PrefixMatchTest" })
        .expect(201);

      expect(createRes.body.key.startsWith(createRes.body.keyPrefix)).toBe(true);
    });
  });
});
