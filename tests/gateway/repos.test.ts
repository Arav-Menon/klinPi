import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {db} from "../../packages/gateway/src/lib/db";
import {users, oauthAccounts, repositories} from "@klinpi/db/schema";
import {eq, inArray} from "drizzle-orm";
import {createRedisClient} from "../../platform/redis/src/client";
import request from "supertest";
import app from "../../packages/gateway/src/app";
import * as oauthService from "../../packages/gateway/src/modules/services/oauth.service";

vi.mock("../../packages/gateway/src/modules/services/oauth.service", async (importOriginal) => {
    const actual =
        await importOriginal<typeof import("../../packages/gateway/src/modules/services/oauth.service")>();
    return {...actual, getGitHubRepos: vi.fn()};
});

const PASSWORD_HASH = "$2b$12$IIJd6p1/RWRSgCes86FCx.PWnExawsl1Lh7n3ZjlhGItBUjXKwMEC";
const PASSWORD = "password123";
const TEST_EMAILS = ["repos-sync@test.com", "repos-upsert@test.com", "repos-failure@test.com"];
const PROVIDER_REPO_ID = "987654321";
const redis = createRedisClient();

const FAKE_REPO = {
    id: Number(PROVIDER_REPO_ID),
    name: "klinpi-test-repo",
    full_name: "testuser-repos/klinpi-test-repo",
    private: false,
    html_url: "https://github.com/testuser-repos/klinpi-test-repo",
    description: "fixture repo",
    default_branch: "main",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    pushed_at: "2026-01-02T00:00:00Z",
    owner: {login: "testuser-repos", id: 424242},
};

async function flushRateLimitKeys() {
    const keys = await redis.keys("rl:*");
    if (keys.length > 0) {
        await redis.del(...keys);
    }
}

async function createUserWithGithub(email: string) {
    const database = db();
    const [user] = await database
        .insert(users)
        .values({email, name: "Repos User", passwordHash: PASSWORD_HASH})
        .returning();

    const signin = await request(app)
        .post("/api/v1/auth/signin")
        .send({email, password: PASSWORD});
    const setCookieHeader = signin.headers["set-cookie"];
    const cookieList = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
    const cookieValue = cookieList
        .find((c: string) => c.startsWith("klinpi_token="))
        ?.split(";")[0];

    await database.insert(oauthAccounts).values({
        userId: user!.id,
        provider: "github",
        providerAccountId: `gh-${user!.id}`,
        accessToken: "test-access-token",
    });

    return {user: user!, cookie: cookieValue!};
}

describe("GET /user/repos", () => {
    beforeEach(async () => {
        const database = db();
        await database
            .delete(repositories)
            .where(eq(repositories.providerRepoId, PROVIDER_REPO_ID));
        await database.delete(users).where(inArray(users.email, TEST_EMAILS));
        await flushRateLimitKeys();
        vi.mocked(oauthService.getGitHubRepos).mockReset();
    });

    afterEach(async () => {
        const database = db();
        await database
            .delete(repositories)
            .where(eq(repositories.providerRepoId, PROVIDER_REPO_ID));
        await database.delete(users).where(inArray(users.email, TEST_EMAILS));
        vi.mocked(oauthService.getGitHubRepos).mockReset();
    });

    it("should sync fetched repos and return their repositoryId", async () => {
        const {user, cookie} = await createUserWithGithub("repos-sync@test.com");
        vi.mocked(oauthService.getGitHubRepos).mockResolvedValue([FAKE_REPO]);

        const response = await request(app)
            .get("/api/v1/user/repos")
            .set("Cookie", cookie);

        expect(response.status).toBe(200);
        expect(response.body.repos).toHaveLength(1);
        const repo = response.body.repos[0];
        expect(repo.id).toBe(Number(PROVIDER_REPO_ID));
        expect(repo.full_name).toBe(FAKE_REPO.full_name);
        expect(typeof repo.repositoryId).toBe("string");

        const database = db();
        const rows = await database
            .select()
            .from(repositories)
            .where(eq(repositories.providerRepoId, PROVIDER_REPO_ID));
        expect(rows).toHaveLength(1);
        expect(rows[0].id).toBe(repo.repositoryId);
        expect(rows[0].userId).toBe(user.id);
        expect(rows[0].cloneUrl).toBe(`https://github.com/${FAKE_REPO.full_name}.git`);
        expect(rows[0].defaultBranch).toBe("main");
    });

    it("should upsert without duplicating rows on repeated calls", async () => {
        const {cookie} = await createUserWithGithub("repos-upsert@test.com");
        vi.mocked(oauthService.getGitHubRepos).mockResolvedValue([FAKE_REPO]);

        const first = await request(app).get("/api/v1/user/repos").set("Cookie", cookie);
        const second = await request(app).get("/api/v1/user/repos").set("Cookie", cookie);

        expect(first.status).toBe(200);
        expect(second.status).toBe(200);
        expect(second.body.repos[0].repositoryId).toBe(first.body.repos[0].repositoryId);

        const database = db();
        const rows = await database
            .select()
            .from(repositories)
            .where(eq(repositories.providerRepoId, PROVIDER_REPO_ID));
        expect(rows).toHaveLength(1);
    });

    it("should still list repos with a null repositoryId when the sync fails", async () => {
        const {cookie} = await createUserWithGithub("repos-failure@test.com");
        // owner: null makes the sync mapping throw, exercising the fallback.
        vi.mocked(oauthService.getGitHubRepos).mockResolvedValue([
            {...FAKE_REPO, owner: null} as unknown as (typeof FAKE_REPO),
        ]);

        const response = await request(app)
            .get("/api/v1/user/repos")
            .set("Cookie", cookie);

        expect(response.status).toBe(200);
        expect(response.body.repos).toHaveLength(1);
        expect(response.body.repos[0].repositoryId).toBeNull();

        const database = db();
        const rows = await database
            .select()
            .from(repositories)
            .where(eq(repositories.providerRepoId, PROVIDER_REPO_ID));
        expect(rows).toHaveLength(0);
    });
});
