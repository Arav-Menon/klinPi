import { describe, it, expect, beforeEach, vi } from "vitest";

const computeMocks = vi.hoisted(() => ({
    connectSbx: vi.fn(),
}));

const redisMock = vi.hoisted(() => ({
    getCache: vi.fn(),
    setCache: vi.fn(),
    deleteCache: vi.fn(),
}));

const dbMock = vi.hoisted(() => ({
    rows: [] as Array<{ accessToken: string | null }>,
    repositoryRows: [] as Array<{
        id?: string;
        fullName: string;
        defaultBranch: string | null;
    }>,
    getDb: vi.fn(),
    schema: {
        oauthAccounts: {
            userId: "userId",
            provider: "provider",
            accessToken: "accessToken",
        },
        repositories: {
            id: "id",
            fullName: "fullName",
            defaultBranch: "defaultBranch",
        },
    },
}));

const fetchMock = vi.hoisted(() => {
    const fn = vi.fn();
    globalThis.fetch = fn as unknown as typeof fetch;
    return fn;
});

vi.mock("@klinpi/compute", () => ({
    readFile: vi.fn(),
    writeFile: vi.fn(),
    listDir: vi.fn(),
    Sandbox: vi.fn(),
    createSandbox: vi.fn(),
    connectSandbox: vi.fn(),
    sandboxManger: { connectSbx: computeMocks.connectSbx },
}));

vi.mock("../../platform/redis/dist/index.js", () => ({ cache: redisMock }));
vi.mock("drizzle-orm", () => ({ eq: vi.fn(), and: vi.fn() }));
vi.mock("@klinpi/db", () => ({
    getDb: dbMock.getDb,
    schema: dbMock.schema,
}));

import { createListIssuesTool } from "../../packages/runtime/src/tools/github_tools/list_issues.js";
import { createGetIssueTool } from "../../packages/runtime/src/tools/github_tools/get_issue.js";
import { createUpdateIssueTool } from "../../packages/runtime/src/tools/github_tools/update_issue.js";
import { createCloseIssueTool } from "../../packages/runtime/src/tools/github_tools/close_issue.js";
import { createCreateIssueTool } from "../../packages/runtime/src/tools/github_tools/create_issue.js";
import { getTools } from "../../packages/runtime/src/tools/index.js";
import type { ToolContext } from "../../packages/runtime/src/types.js";
import { createRunWorkflowState } from "../../packages/runtime/src/lib/workflowState.js";

const TOKEN = "gho_SuperSecretToken123abcDEF";
const ARGS = { owner: "octocat", repo: "hello-world" };

function makeDb() {
    const select = vi.fn(() => ({
        from: (table: unknown) => {
            const limit = vi.fn(() =>
                Promise.resolve(
                    table === dbMock.schema.repositories
                        ? dbMock.repositoryRows
                        : dbMock.rows,
                ),
            );
            const where = vi.fn().mockReturnValue({ limit });
            return { where };
        },
    }));
    return { select };
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

function linkedContext(userId = "user-1"): ToolContext {
    return {
        ...makeContext(userId),
        repositoryId: "repo-1",
    };
}

function githubRespond(
    status: number,
    body: unknown,
    headers: Record<string, string> = {},
) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...headers },
    });
}

function callUrl(index = 0): URL {
    const [url] = fetchMock.mock.calls[index] as [string, RequestInit];
    return new URL(url);
}

function callInit(index = 0): RequestInit {
    const [, init] = fetchMock.mock.calls[index] as [string, RequestInit];
    return init;
}

function issuePayload(overrides: Record<string, unknown> = {}) {
    return {
        number: 42,
        html_url: "https://github.com/octocat/hello-world/issues/42",
        title: "Broken widget",
        body: "It breaks sometimes.",
        state: "open",
        labels: [{ name: "bug" }, { name: "ui" }],
        assignees: [{ login: "octocat" }],
        milestone: { title: "v1.0", number: 1 },
        user: { login: "octocat" },
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-02T00:00:00Z",
        ...overrides,
    };
}

function pullRequestPayload(overrides: Record<string, unknown> = {}) {
    return issuePayload({
        number: 7,
        title: "Add feature",
        pull_request: {
            url: "https://api.github.com/repos/octocat/hello-world/pulls/7",
        },
        ...overrides,
    });
}

describe("issue tools", () => {
    let db: ReturnType<typeof makeDb>;

    beforeEach(() => {
        redisMock.getCache.mockReset().mockResolvedValue(TOKEN);
        redisMock.setCache.mockReset().mockResolvedValue(undefined);
        redisMock.deleteCache.mockReset().mockResolvedValue(undefined);
        dbMock.rows = [];
        dbMock.repositoryRows = [];
        dbMock.getDb.mockReset();
        fetchMock.mockReset().mockResolvedValue(githubRespond(200, []));
        db = makeDb();
        dbMock.getDb.mockReturnValue(db);
    });

    describe("list_issues tool", () => {
        it("does not accept userId as a tool argument", () => {
            const tool = createListIssuesTool(makeContext());
            expect(tool.parameters.properties).not.toHaveProperty("userId");
            expect(tool.parameters.required).toEqual(["owner", "repo"]);
            expect(tool.requiresSandbox).toBeUndefined();
        });

        it("lists issues and excludes pull requests from the Issues API", async () => {
            fetchMock.mockResolvedValue(
                githubRespond(200, [
                    issuePayload(),
                    pullRequestPayload(),
                    issuePayload({
                        number: 9,
                        title: "Docs typo",
                        state: "closed",
                        labels: [],
                        milestone: null,
                        assignees: [],
                    }),
                ]),
            );

            const result = await createListIssuesTool(makeContext()).execute(
                ARGS,
                "",
            );

            expect(fetchMock).toHaveBeenCalledTimes(1);
            expect(callInit().method).toBe("GET");
            expect(callUrl().pathname).toBe("/repos/octocat/hello-world/issues");
            expect(callUrl().searchParams.get("state")).toBe("open");

            expect(result.excludedPullRequests).toBe(1);
            expect(result.page).toBe(1);
            expect(result.perPage).toBe(30);
            expect(result.hasMore).toBe(false);
            expect(result.issues).toHaveLength(2);
            expect(result.issues[0]).toEqual({
                issueNumber: 42,
                title: "Broken widget",
                state: "open",
                url: "https://github.com/octocat/hello-world/issues/42",
                body: "It breaks sometimes.",
                labels: ["bug", "ui"],
                assignees: ["octocat"],
                createdAt: "2026-01-01T00:00:00Z",
                updatedAt: "2026-01-02T00:00:00Z",
            });
            expect(result.issues[1].issueNumber).toBe(9);
            expect(result.issues[1].labels).toEqual([]);
            expect(JSON.stringify(result)).not.toContain(TOKEN);
        });

        it("passes filters and pagination to the GitHub API", async () => {
            await createListIssuesTool(makeContext()).execute(
                {
                    ...ARGS,
                    state: "all",
                    labels: ["bug", "ui"],
                    assignee: "octocat",
                    milestone: 3,
                    sort: "updated",
                    direction: "asc",
                    perPage: 50,
                    page: 2,
                },
                "",
            );

            const url = callUrl();
            expect(url.searchParams.get("state")).toBe("all");
            expect(url.searchParams.get("labels")).toBe("bug,ui");
            expect(url.searchParams.get("assignee")).toBe("octocat");
            expect(url.searchParams.get("milestone")).toBe("3");
            expect(url.searchParams.get("sort")).toBe("updated");
            expect(url.searchParams.get("direction")).toBe("asc");
            expect(url.searchParams.get("per_page")).toBe("50");
            expect(url.searchParams.get("page")).toBe("2");
        });

        it("reports hasMore when GitHub returns a next page", async () => {
            fetchMock.mockResolvedValue(
                githubRespond(200, [issuePayload()], {
                    link: '<https://api.github.com/repos/octocat/hello-world/issues?page=2>; rel="next", <https://api.github.com/repos/octocat/hello-world/issues?page=5>; rel="last"',
                }),
            );

            const result = await createListIssuesTool(makeContext()).execute(
                ARGS,
                "",
            );

            expect(result.hasMore).toBe(true);
            expect(result.issues).toHaveLength(1);
        });

        it("truncates oversized issue bodies in list results", async () => {
            fetchMock.mockResolvedValue(
                githubRespond(200, [issuePayload({ body: "x".repeat(600) })]),
            );

            const result = await createListIssuesTool(makeContext()).execute(
                ARGS,
                "",
            );

            expect(result.issues[0].body).toHaveLength(501);
            expect(result.issues[0].body.endsWith("…")).toBe(true);
        });

        it("reuses the cached token without hitting the database", async () => {
            fetchMock.mockResolvedValue(githubRespond(200, [issuePayload()]));

            await createListIssuesTool(makeContext()).execute(ARGS, "");

            expect(dbMock.getDb).not.toHaveBeenCalled();
            expect(redisMock.setCache).not.toHaveBeenCalled();
        });

        it("reads the token from the database on cache miss and caches it for 1 hour", async () => {
            redisMock.getCache.mockResolvedValue(null);
            dbMock.rows = [{ accessToken: TOKEN }];

            await createListIssuesTool(makeContext()).execute(ARGS, "");

            expect(db.select).toHaveBeenCalled();
            expect(redisMock.setCache).toHaveBeenCalledWith(
                "github:access-token:user-1",
                TOKEN,
                3600,
            );
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        it("returns an authentication error when no GitHub account is connected", async () => {
            redisMock.getCache.mockResolvedValue(null);
            dbMock.rows = [{ accessToken: null }];

            const result = await createListIssuesTool(makeContext()).execute(
                ARGS,
                "",
            );

            expect(String(result)).toMatch(/^Error: no GitHub account is connected/);
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it("maps a 404 to a repository access error", async () => {
            fetchMock.mockResolvedValue(githubRespond(404, { message: "Not Found" }));

            const result = await createListIssuesTool(makeContext()).execute(
                ARGS,
                "",
            );

            expect(result).toBe(
                "Error: GitHub repository 'octocat/hello-world' was not found or the authenticated user does not have access to it.",
            );
            expect(String(result)).not.toContain(TOKEN);
        });

        it("maps a 403 to a permissions or rate-limit error", async () => {
            fetchMock.mockResolvedValue(
                githubRespond(403, { message: "API rate limit exceeded" }),
            );

            const result = await createListIssuesTool(makeContext()).execute(
                ARGS,
                "",
            );

            expect(String(result)).toContain("403");
            expect(String(result)).toContain("rate limited");
            expect(String(result)).not.toContain(TOKEN);
        });

        it("validates arguments before calling GitHub", async () => {
            const missing = await createListIssuesTool(makeContext()).execute(
                {},
                "",
            );
            expect(missing).toBe(
                "Error: 'owner' and 'repo' are required and must be non-empty strings.",
            );

            const badState = await createListIssuesTool(makeContext()).execute(
                { ...ARGS, state: "ALL" },
                "",
            );
            expect(badState).toBe(
                "Error: 'state' must be one of: open, closed, all.",
            );

            const badPage = await createListIssuesTool(makeContext()).execute(
                { ...ARGS, perPage: 0 },
                "",
            );
            expect(badPage).toBe(
                "Error: 'perPage' must be an integer between 1 and 100.",
            );

            expect(fetchMock).not.toHaveBeenCalled();
        });
    });

    describe("get_issue tool", () => {
        it("does not accept userId as a tool argument", () => {
            const tool = createGetIssueTool(makeContext());
            expect(tool.parameters.properties).not.toHaveProperty("userId");
            expect(tool.parameters.required).toEqual([
                "owner",
                "repo",
                "issueNumber",
            ]);
            expect(tool.requiresSandbox).toBeUndefined();
        });

        it("retrieves a specific issue as structured data", async () => {
            fetchMock.mockResolvedValue(githubRespond(200, issuePayload()));

            const result = await createGetIssueTool(makeContext()).execute(
                { ...ARGS, issueNumber: 42 },
                "",
            );

            expect(fetchMock).toHaveBeenCalledTimes(1);
            expect(callInit().method).toBe("GET");
            expect(callUrl().pathname).toBe(
                "/repos/octocat/hello-world/issues/42",
            );
            expect(result).toEqual({
                issueNumber: 42,
                title: "Broken widget",
                body: "It breaks sometimes.",
                state: "open",
                url: "https://github.com/octocat/hello-world/issues/42",
                labels: ["bug", "ui"],
                assignees: ["octocat"],
                milestone: "v1.0",
                author: "octocat",
                createdAt: "2026-01-01T00:00:00Z",
                updatedAt: "2026-01-02T00:00:00Z",
            });
            expect(JSON.stringify(result)).not.toContain(TOKEN);
        });

        it("reports when the requested number is a pull request", async () => {
            fetchMock.mockResolvedValue(githubRespond(200, pullRequestPayload()));

            const result = await createGetIssueTool(makeContext()).execute(
                { ...ARGS, issueNumber: 7 },
                "",
            );

            expect(String(result)).toContain(
                "#7 in 'octocat/hello-world' is a pull request, not an issue",
            );
            expect(String(result)).not.toContain(TOKEN);
        });

        it("maps a 404 to an issue-not-found error", async () => {
            fetchMock.mockResolvedValue(githubRespond(404, { message: "Not Found" }));

            const result = await createGetIssueTool(makeContext()).execute(
                { ...ARGS, issueNumber: 42 },
                "",
            );

            expect(result).toBe(
                "Error: GitHub issue #42 was not found in 'octocat/hello-world' — it may not exist, or the authenticated user does not have access to it.",
            );
            expect(String(result)).not.toContain(TOKEN);
        });

        it("validates the issue number before calling GitHub", async () => {
            const missing = await createGetIssueTool(makeContext()).execute(
                ARGS,
                "",
            );
            expect(missing).toBe(
                "Error: 'issueNumber' is required and must be a positive integer.",
            );

            const invalid = await createGetIssueTool(makeContext()).execute(
                { ...ARGS, issueNumber: 0 },
                "",
            );
            expect(invalid).toBe(
                "Error: 'issueNumber' is required and must be a positive integer.",
            );

            expect(fetchMock).not.toHaveBeenCalled();
        });
    });

    describe("update_issue tool", () => {
        it("does not accept userId as a tool argument", () => {
            const tool = createUpdateIssueTool(makeContext());
            expect(tool.parameters.properties).not.toHaveProperty("userId");
            expect(tool.parameters.required).toEqual([
                "owner",
                "repo",
                "issueNumber",
            ]);
            expect(tool.requiresSandbox).toBeUndefined();
        });

        it("sends only the provided fields to the GitHub API", async () => {
            fetchMock
                .mockResolvedValueOnce(githubRespond(200, issuePayload()))
                .mockResolvedValueOnce(
                    githubRespond(
                        200,
                        issuePayload({ title: "New title", state: "closed" }),
                    ),
                );

            const result = await createUpdateIssueTool(makeContext()).execute(
                { ...ARGS, issueNumber: 42, title: "New title", state: "closed" },
                "",
            );

            expect(fetchMock).toHaveBeenCalledTimes(2);
            expect(callInit(0).method).toBe("GET");
            expect(callInit(1).method).toBe("PATCH");
            expect(callUrl(1).pathname).toBe(
                "/repos/octocat/hello-world/issues/42",
            );
            expect(JSON.parse(callInit(1).body as string)).toEqual({
                title: "New title",
                state: "closed",
            });
            expect(result.title).toBe("New title");
            expect(result.state).toBe("closed");
            expect(JSON.stringify(result)).not.toContain(TOKEN);
        });

        it("clears labels when an empty array is provided", async () => {
            fetchMock
                .mockResolvedValueOnce(githubRespond(200, issuePayload()))
                .mockResolvedValueOnce(
                    githubRespond(200, issuePayload({ labels: [] })),
                );

            await createUpdateIssueTool(makeContext()).execute(
                { ...ARGS, issueNumber: 42, labels: [] },
                "",
            );

            expect(JSON.parse(callInit(1).body as string)).toEqual({
                labels: [],
            });
        });

        it("refuses to update a pull request", async () => {
            fetchMock.mockResolvedValue(githubRespond(200, pullRequestPayload()));

            const result = await createUpdateIssueTool(makeContext()).execute(
                { ...ARGS, issueNumber: 7, title: "Sneaky edit" },
                "",
            );

            expect(String(result)).toContain(
                "#7 in 'octocat/hello-world' is a pull request, not an issue",
            );
            expect(fetchMock).toHaveBeenCalledTimes(1);
            expect(callInit().method).toBe("GET");
        });

        it("requires at least one field to update", async () => {
            const result = await createUpdateIssueTool(makeContext()).execute(
                { ...ARGS, issueNumber: 42 },
                "",
            );

            expect(result).toBe(
                "Error: provide at least one field to update: 'title', 'body', 'state', 'labels', 'assignees' or 'milestone'.",
            );
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it("validates the state and other fields before calling GitHub", async () => {
            const badState = await createUpdateIssueTool(makeContext()).execute(
                { ...ARGS, issueNumber: 42, state: "merged" },
                "",
            );
            expect(badState).toBe(
                "Error: 'state' must be one of: open, closed.",
            );

            const badLabels = await createUpdateIssueTool(makeContext()).execute(
                { ...ARGS, issueNumber: 42, labels: "bug" },
                "",
            );
            expect(badLabels).toBe(
                "Error: 'labels' must be an array of strings.",
            );

            const badTitle = await createUpdateIssueTool(makeContext()).execute(
                { ...ARGS, issueNumber: 42, title: "   " },
                "",
            );
            expect(badTitle).toBe("Error: 'title' must be a non-empty string.");

            expect(fetchMock).not.toHaveBeenCalled();
        });

        it("clears the cached token on 401 without leaking it", async () => {
            fetchMock
                .mockResolvedValueOnce(githubRespond(200, issuePayload()))
                .mockResolvedValueOnce(
                    githubRespond(401, { message: `Bad credentials for ${TOKEN}` }),
                );

            const result = await createUpdateIssueTool(makeContext()).execute(
                { ...ARGS, issueNumber: 42, title: "New title" },
                "",
            );

            expect(String(result)).toContain("401");
            expect(String(result)).not.toContain(TOKEN);
            expect(redisMock.deleteCache).toHaveBeenCalledWith(
                "github:access-token:user-1",
            );
        });

        it("maps a 422 to a payload validation error", async () => {
            fetchMock
                .mockResolvedValueOnce(githubRespond(200, issuePayload()))
                .mockResolvedValueOnce(
                    githubRespond(422, { message: "Validation Failed" }),
                );

            const result = await createUpdateIssueTool(makeContext()).execute(
                { ...ARGS, issueNumber: 42, milestone: 1 },
                "",
            );

            expect(String(result)).toContain("422");
            expect(String(result)).toContain(
                "Check the 'state', labels, assignees and milestone values.",
            );
            expect(String(result)).not.toContain(TOKEN);
        });

        it("maps a 404 during the pre-check to an issue-not-found error", async () => {
            fetchMock.mockResolvedValue(githubRespond(404, { message: "Not Found" }));

            const result = await createUpdateIssueTool(makeContext()).execute(
                { ...ARGS, issueNumber: 42, title: "New title" },
                "",
            );

            expect(result).toBe(
                "Error: GitHub issue #42 was not found in 'octocat/hello-world' — it may not exist, or the authenticated user does not have access to it.",
            );
        });
    });

    describe("close_issue tool", () => {
        it("does not accept userId as a tool argument", () => {
            const tool = createCloseIssueTool(makeContext());
            expect(tool.parameters.properties).not.toHaveProperty("userId");
            expect(tool.parameters.required).toEqual([
                "owner",
                "repo",
                "issueNumber",
            ]);
            expect(tool.requiresSandbox).toBeUndefined();
        });

        it("closes the issue through the GitHub issue update endpoint", async () => {
            fetchMock
                .mockResolvedValueOnce(githubRespond(200, issuePayload()))
                .mockResolvedValueOnce(
                    githubRespond(200, issuePayload({ state: "closed" })),
                );

            const result = await createCloseIssueTool(makeContext()).execute(
                { ...ARGS, issueNumber: 42 },
                "",
            );

            expect(fetchMock).toHaveBeenCalledTimes(2);
            expect(callInit(1).method).toBe("PATCH");
            expect(callUrl(1).pathname).toBe(
                "/repos/octocat/hello-world/issues/42",
            );
            expect(JSON.parse(callInit(1).body as string)).toEqual({
                state: "closed",
            });
            expect(result).toEqual({
                issueNumber: 42,
                title: "Broken widget",
                state: "closed",
                url: "https://github.com/octocat/hello-world/issues/42",
            });
            expect(JSON.stringify(result)).not.toContain(TOKEN);
        });

        it("refuses to close a pull request", async () => {
            fetchMock.mockResolvedValue(githubRespond(200, pullRequestPayload()));

            const result = await createCloseIssueTool(makeContext()).execute(
                { ...ARGS, issueNumber: 7 },
                "",
            );

            expect(String(result)).toContain(
                "#7 in 'octocat/hello-world' is a pull request, not an issue",
            );
            expect(fetchMock).toHaveBeenCalledTimes(1);
            expect(callInit().method).toBe("GET");
        });

        it("validates arguments before calling GitHub", async () => {
            const missingRepo = await createCloseIssueTool(makeContext()).execute(
                {},
                "",
            );
            expect(missingRepo).toBe(
                "Error: 'owner' and 'repo' are required and must be non-empty strings.",
            );

            const missingNumber = await createCloseIssueTool(makeContext()).execute(
                ARGS,
                "",
            );
            expect(missingNumber).toBe(
                "Error: 'issueNumber' is required and must be a positive integer.",
            );

            expect(fetchMock).not.toHaveBeenCalled();
        });
    });

    describe("linked repository resolution", () => {
        beforeEach(() => {
            dbMock.repositoryRows = [
                {
                    id: "repo-1",
                    fullName: "Arav-Menon/py-backend",
                    defaultBranch: "main",
                },
            ];
        });

        it("advertises owner and repo as optional when a repository is linked", () => {
            expect(
                createListIssuesTool(linkedContext()).parameters.required,
            ).toEqual([]);
            expect(
                createGetIssueTool(linkedContext()).parameters.required,
            ).toEqual(["issueNumber"]);
            expect(
                createUpdateIssueTool(linkedContext()).parameters.required,
            ).toEqual(["issueNumber"]);
            expect(
                createCloseIssueTool(linkedContext()).parameters.required,
            ).toEqual(["issueNumber"]);
            expect(
                createCreateIssueTool(linkedContext()).parameters.required,
            ).toEqual(["title"]);
        });

        it("lists issues from the linked repository without owner/repo arguments", async () => {
            fetchMock.mockResolvedValue(githubRespond(200, [issuePayload()]));

            const result = await createListIssuesTool(linkedContext()).execute(
                {},
                "",
            );

            expect(callUrl().pathname).toBe("/repos/Arav-Menon/py-backend/issues");
            expect(result.issues).toHaveLength(1);
        });

        it("fetches a single issue from the linked repository", async () => {
            fetchMock.mockResolvedValue(githubRespond(200, issuePayload()));

            await createGetIssueTool(linkedContext()).execute(
                { issueNumber: 42 },
                "",
            );

            expect(callUrl().pathname).toBe(
                "/repos/Arav-Menon/py-backend/issues/42",
            );
        });

        it("accepts a case-insensitive match against the linked repository", async () => {
            fetchMock.mockResolvedValue(githubRespond(200, [issuePayload()]));

            await createListIssuesTool(linkedContext()).execute(
                { owner: "arav-menon", repo: "PY-BACKEND" },
                "",
            );

            expect(callUrl().pathname).toBe("/repos/Arav-Menon/py-backend/issues");
        });

        it("rejects a hallucinated owner/repo instead of hitting GitHub with it", async () => {
            const result = await createCreateIssueTool(linkedContext()).execute(
                {
                    owner: "example_owner",
                    repo: "example_repo",
                    title: "UI Redesign",
                },
                "",
            );

            expect(String(result)).toContain(
                "linked to repository 'Arav-Menon/py-backend'",
            );
            expect(String(result)).toContain("expected owner 'Arav-Menon'");
            expect(String(result)).toContain(
                "Set owner to 'Arav-Menon' and repo to 'py-backend'",
            );
            expect(String(result)).not.toContain(TOKEN);
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it("creates an issue in the linked repository without owner/repo", async () => {
            fetchMock.mockResolvedValue(githubRespond(201, issuePayload()));

            const result = await createCreateIssueTool(linkedContext()).execute(
                { title: "UI Redesign", body: "Make it pop." },
                "",
            );

            expect(callInit().method).toBe("POST");
            expect(callUrl().pathname).toBe("/repos/Arav-Menon/py-backend/issues");
            expect(JSON.parse(callInit().body as string)).toEqual({
                title: "UI Redesign",
                body: "Make it pop.",
            });
            expect(result.issueNumber).toBe(42);
        });

        it("requires owner/repo again when the linked repository row is missing", async () => {
            dbMock.repositoryRows = [];

            const result = await createListIssuesTool(linkedContext()).execute(
                {},
                "",
            );

            expect(result).toBe(
                "Error: 'owner' and 'repo' are required and must be non-empty strings.",
            );
            expect(fetchMock).not.toHaveBeenCalled();
        });
    });

    describe("tool registry", () => {
        it("registers every issue tool", () => {
            const names = getTools(makeContext()).map((tool) => tool.name);

            expect(names).toEqual(
                expect.arrayContaining([
                    "create_issue",
                    "list_issues",
                    "get_issue",
                    "update_issue",
                    "close_issue",
                ]),
            );
        });
    });
});
