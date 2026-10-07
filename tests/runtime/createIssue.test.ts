import { describe, it, expect, beforeEach, vi } from "vitest";

const redisMock = vi.hoisted(() => ({
    getCache: vi.fn(),
    setCache: vi.fn(),
    deleteCache: vi.fn(),
}));

const dbMock = vi.hoisted(() => ({
    rows: [] as Array<{ accessToken: string | null }>,
    getDb: vi.fn(),
}));

const fetchMock = vi.hoisted(() => {
    const fn = vi.fn();
    globalThis.fetch = fn as unknown as typeof fetch;
    return fn;
});

vi.mock("../../platform/redis/dist/index.js", () => ({ cache: redisMock }));
vi.mock("drizzle-orm", () => ({ eq: vi.fn(), and: vi.fn() }));
vi.mock("@klinpi/db", () => ({
    getDb: dbMock.getDb,
    schema: {
        oauthAccounts: {
            userId: "userId",
            provider: "provider",
            accessToken: "accessToken",
        },
    },
}));

import { createCreateIssueTool } from "../../packages/runtime/src/tools/github_tools/create_issue.js";
import type { ToolContext } from "../../packages/runtime/src/types.js";
import { createRunWorkflowState } from "../../packages/runtime/src/lib/workflowState.js";

const TOKEN = "gho_SuperSecretToken123abcDEF";

function makeDb() {
    const limit = vi.fn(() => Promise.resolve(dbMock.rows));
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    return { select, from, where, limit };
}

function makeContext(userId = "user-1"): ToolContext {
    return {
        memoryService: {} as ToolContext["memoryService"],
        userId,
        sessionId: "session-1",
        repositoryId: null,
        workflow: createRunWorkflowState(),
    };
}

function githubRespond(status: number, body: unknown) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
    });
}

const args = { owner: "octocat", repo: "hello-world", title: "Broken widget" };
const issueBody = {
    number: 42,
    html_url: "https://github.com/octocat/hello-world/issues/42",
    title: "Broken widget",
    state: "open",
};

describe("create_issue tool", () => {
    let db: ReturnType<typeof makeDb>;

    beforeEach(() => {
        redisMock.getCache.mockReset().mockResolvedValue(null);
        redisMock.setCache.mockReset().mockResolvedValue(undefined);
        redisMock.deleteCache.mockReset().mockResolvedValue(undefined);
        dbMock.rows = [];
        dbMock.getDb.mockReset();
        fetchMock.mockReset().mockResolvedValue(githubRespond(201, issueBody));
        db = makeDb();
        dbMock.getDb.mockReturnValue(db);
    });

    it("does not accept userId as a tool argument", () => {
        const tool = createCreateIssueTool(makeContext());
        expect(tool.parameters.properties).not.toHaveProperty("userId");
        expect(tool.parameters.required).toEqual(["owner", "repo", "title"]);
        expect(tool.requiresSandbox).toBeUndefined();
    });

    it("reuses the cached token without hitting the database", async () => {
        redisMock.getCache.mockResolvedValue(TOKEN);

        const result = await createCreateIssueTool(makeContext()).execute(args, "");

        expect(dbMock.getDb).not.toHaveBeenCalled();
        expect(result).toEqual({
            issueNumber: 42,
            url: "https://github.com/octocat/hello-world/issues/42",
            title: "Broken widget",
            state: "open",
        });
        expect(JSON.stringify(result)).not.toContain(TOKEN);
    });

    it("POSTs to /repos/{owner}/{repo}/issues with the cached token", async () => {
        redisMock.getCache.mockResolvedValue(TOKEN);

        await createCreateIssueTool(makeContext()).execute(args, "");

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe("https://api.github.com/repos/octocat/hello-world/issues");
        expect(init.method).toBe("POST");
        const headers = init.headers as Record<string, string>;
        expect(JSON.stringify(headers)).toContain(TOKEN);
        expect(JSON.parse(init.body as string)).toEqual({ title: "Broken widget" });
    });

    it("reads the token from the database on cache miss and caches it for 1 hour", async () => {
        dbMock.rows = [{ accessToken: TOKEN }];

        await createCreateIssueTool(makeContext()).execute(args, "");

        expect(db.select).toHaveBeenCalled();
        expect(redisMock.setCache).toHaveBeenCalledWith(
            "github:access-token:user-1",
            TOKEN,
            3600,
        );
        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(JSON.stringify(init.headers as Record<string, string>)).toContain(TOKEN);
    });

    it("returns an authentication error when no GitHub account is connected", async () => {
        dbMock.rows = [{ accessToken: null }];

        const result = await createCreateIssueTool(makeContext()).execute(args, "");

        expect(result).toMatch(/^Error: no GitHub account is connected/);
        expect(redisMock.setCache).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("forwards optional fields to the GitHub API", async () => {
        redisMock.getCache.mockResolvedValue(TOKEN);

        await createCreateIssueTool(makeContext()).execute(
            {
                ...args,
                body: "details",
                labels: ["bug"],
                assignees: ["octocat"],
                milestone: 2,
            },
            "",
        );

        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(JSON.parse(init.body as string)).toEqual({
            title: "Broken widget",
            body: "details",
            labels: ["bug"],
            assignees: ["octocat"],
            milestone: 2,
        });
    });

    it("clears the cache and reports a rejected token without leaking it", async () => {
        redisMock.getCache.mockResolvedValue(TOKEN);
        fetchMock.mockResolvedValue(
            githubRespond(401, { message: `Bad credentials for ${TOKEN}` }),
        );

        const result = await createCreateIssueTool(makeContext()).execute(args, "");

        expect(String(result)).toContain("401");
        expect(String(result)).not.toContain(TOKEN);
        expect(redisMock.deleteCache).toHaveBeenCalledWith("github:access-token:user-1");
    });

    it("maps a 404 to a repository access error", async () => {
        redisMock.getCache.mockResolvedValue(TOKEN);
        fetchMock.mockResolvedValue(githubRespond(404, { message: "Not Found" }));

        const result = await createCreateIssueTool(makeContext()).execute(args, "");

        expect(result).toBe(
            "Error: GitHub repository 'octocat/hello-world' was not found or the authenticated user does not have access to it.",
        );
        expect(String(result)).not.toContain(TOKEN);
    });

    it("validates required arguments", async () => {
        const result = await createCreateIssueTool(makeContext()).execute({}, "");

        expect(result).toBe(
            "Error: 'owner', 'repo' and 'title' are required and must be non-empty strings.",
        );
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
