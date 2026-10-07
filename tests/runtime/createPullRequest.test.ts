import { describe, it, expect, beforeEach, vi } from "vitest";

const redisMock = vi.hoisted(() => ({
  getCache: vi.fn(),
  setCache: vi.fn(),
  deleteCache: vi.fn(),
}));

const dbMock = vi.hoisted(() => ({
  rows: [] as Array<{ accessToken: string | null }>,
  repositoryRows: [] as Array<{ fullName: string; defaultBranch: string | null }>,
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

vi.mock("../../platform/redis/dist/index.js", () => ({ cache: redisMock }));
vi.mock("drizzle-orm", () => ({ eq: vi.fn(), and: vi.fn() }));
vi.mock("@klinpi/db", () => ({
  getDb: dbMock.getDb,
  schema: dbMock.schema,
}));

import { createCreatePullRequestTool } from "../../packages/runtime/src/tools/github_tools/create_pull_request.js";
import type { ToolContext } from "../../packages/runtime/src/types.js";
import { createRunWorkflowState } from "../../packages/runtime/src/lib/workflowState.js";

const TOKEN = "gho_SuperSecretToken123abcDEF";

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

function githubRespond(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const args = {
  owner: "octocat",
  repo: "hello-world",
  title: "fix: resolve login validation",
  head: "fix-login",
  base: "main",
};

const prBody = {
  number: 7,
  html_url: "https://github.com/octocat/hello-world/pull/7",
  title: "fix: resolve login validation",
  state: "open",
  head: { ref: "fix-login" },
  base: { ref: "main" },
};

const compareBody = {
  status: "ahead",
  ahead_by: 3,
  total_commits: 3,
};

describe("create_pull_request tool", () => {
  let db: ReturnType<typeof makeDb>;

  beforeEach(() => {
    redisMock.getCache.mockReset().mockResolvedValue(null);
    redisMock.setCache.mockReset().mockResolvedValue(undefined);
    redisMock.deleteCache.mockReset().mockResolvedValue(undefined);
    dbMock.rows = [];
    dbMock.repositoryRows = [];
    dbMock.getDb.mockReset();
    fetchMock.mockReset().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/compare/")) {
        return githubRespond(200, compareBody);
      }
      return githubRespond(201, prBody);
    });
    db = makeDb();
    dbMock.getDb.mockReturnValue(db);
  });

  it("does not accept userId as a tool argument", () => {
    const tool = createCreatePullRequestTool(makeContext());
    expect(tool.parameters.properties).not.toHaveProperty("userId");
    expect(tool.parameters.required).toEqual([
      "owner",
      "repo",
      "title",
      "head",
      "base",
    ]);
    expect(tool.requiresSandbox).toBeUndefined();
  });

  it("describes itself as the final GitHub API step only", () => {
    const tool = createCreatePullRequestTool(makeContext());
    expect(tool.description).toContain("FINAL step");
    expect(tool.description).toContain("pushed");
    expect(tool.description).toContain("never creates or switches branches");
    expect(tool.parameters.properties.head?.description).toContain(
      "already pushed to GitHub",
    );
  });

  it("verifies the head branch exists on GitHub before POSTing /pulls", async () => {
    redisMock.getCache.mockResolvedValue(TOKEN);

    const result = await createCreatePullRequestTool(makeContext()).execute(
      args,
      "",
    );

    expect(result).toEqual({
      pullRequestNumber: 7,
      url: "https://github.com/octocat/hello-world/pull/7",
      title: "fix: resolve login validation",
      state: "open",
      head: "fix-login",
      base: "main",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [compareUrl, compareInit] = fetchMock.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(compareUrl).toBe(
      "https://api.github.com/repos/octocat/hello-world/compare/main...fix-login",
    );
    expect(compareInit.method ?? "GET").toBe("GET");

    const [prUrl, prInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(prUrl).toBe("https://api.github.com/repos/octocat/hello-world/pulls");
    expect(prInit.method).toBe("POST");
    expect(JSON.parse(prInit.body as string)).toEqual({
      title: "fix: resolve login validation",
      head: "fix-login",
      base: "main",
    });
  });

  it("refuses to create a PR when the head branch has not been pushed", async () => {
    redisMock.getCache.mockResolvedValue(TOKEN);
    fetchMock.mockResolvedValue(githubRespond(404, { message: "Not Found" }));

    const result = await createCreatePullRequestTool(makeContext()).execute(
      args,
      "",
    );

    expect(String(result)).toContain("push 'fix-login'");
    expect(String(result)).toContain("only works when the head branch already exists");
    expect(String(result)).not.toContain(TOKEN);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain("/compare/main...fix-login");
    expect(url).not.toContain("/pulls");
  });

  it("refuses to create a PR when head has no commits ahead of base", async () => {
    redisMock.getCache.mockResolvedValue(TOKEN);
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/compare/")) {
        return githubRespond(200, { status: "identical", ahead_by: 0, total_commits: 0 });
      }
      return githubRespond(201, prBody);
    });

    const result = await createCreatePullRequestTool(makeContext()).execute(
      args,
      "",
    );

    expect(String(result)).toContain("no commits ahead of 'main'");
    expect(String(result)).toContain("push 'fix-login'");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).not.toContain("/pulls");
  });

  it("refuses to open a PR when this run modified files that were never pushed", async () => {
    redisMock.getCache.mockResolvedValue(TOKEN);
    const context = makeContext();
    context.workflow.inspected = true;
    context.workflow.writeCount = 1;
    context.workflow.writtenPaths.add("/workspace/Dockerfile");

    const result = await createCreatePullRequestTool(context).execute(args, "");

    expect(String(result)).toContain("have not been pushed yet");
    expect(String(result)).toContain("/workspace/Dockerfile");
    expect(String(result)).toContain("git_stage");
    expect(String(result)).toContain("git_commit");
    expect(String(result)).toContain("git_push");
    expect(String(result)).toContain("git_push once to confirm");
    expect(String(result)).not.toContain(TOKEN);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("opens the PR once the run's writes have been pushed", async () => {
    redisMock.getCache.mockResolvedValue(TOKEN);
    const context = makeContext();
    context.workflow.inspected = true;
    context.workflow.writeCount = 1;
    context.workflow.writesAtLastPush = 1;
    context.workflow.pushedBranches.add("fix-login");

    const result = await createCreatePullRequestTool(context).execute(args, "");

    expect(result).toMatchObject({ pullRequestNumber: 7, head: "fix-login" });
    expect(context.workflow.prCreated).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url] = fetchMock.mock.calls[1] as [string];
    expect(url).toBe("https://api.github.com/repos/octocat/hello-world/pulls");
  });

  it("reuses the cached token, skips the database and POSTs /repos/{owner}/{repo}/pulls", async () => {
    redisMock.getCache.mockResolvedValue(TOKEN);

    const result = await createCreatePullRequestTool(makeContext()).execute(
      args,
      "",
    );

    expect(dbMock.getDb).not.toHaveBeenCalled();
    expect(result).toEqual({
      pullRequestNumber: 7,
      url: "https://github.com/octocat/hello-world/pull/7",
      title: "fix: resolve login validation",
      state: "open",
      head: "fix-login",
      base: "main",
    });
    expect(JSON.stringify(result)).not.toContain(TOKEN);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/octocat/hello-world/pulls");
    expect(init.method).toBe("POST");
    expect(JSON.stringify(init.headers as Record<string, string>)).toContain(
      TOKEN,
    );
    expect(JSON.parse(init.body as string)).toEqual({
      title: "fix: resolve login validation",
      head: "fix-login",
      base: "main",
    });
  });

  it("reads the token from the database on cache miss and caches it for 1 hour", async () => {
    dbMock.rows = [{ accessToken: TOKEN }];

    await createCreatePullRequestTool(makeContext()).execute(args, "");

    expect(db.select).toHaveBeenCalled();
    expect(redisMock.setCache).toHaveBeenCalledWith(
      "github:access-token:user-1",
      TOKEN,
      3600,
    );
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.stringify(init.headers as Record<string, string>)).toContain(
      TOKEN,
    );
  });

  it("returns an authentication error when no GitHub account is connected", async () => {
    dbMock.rows = [{ accessToken: null }];

    const result = await createCreatePullRequestTool(makeContext()).execute(
      args,
      "",
    );

    expect(result).toMatch(/^Error: no GitHub account is connected/);
    expect(redisMock.setCache).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards the optional body to the GitHub API", async () => {
    redisMock.getCache.mockResolvedValue(TOKEN);

    await createCreatePullRequestTool(makeContext()).execute(
      { ...args, body: "This PR fixes the login validation issue." },
      "",
    );

    const [, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(init.body as string)).toEqual({
      title: "fix: resolve login validation",
      head: "fix-login",
      base: "main",
      body: "This PR fixes the login validation issue.",
    });
  });

  it("clears the cache and reports a rejected token without leaking it", async () => {
    redisMock.getCache.mockResolvedValue(TOKEN);
    fetchMock.mockResolvedValue(
      githubRespond(401, { message: `Bad credentials for ${TOKEN}` }),
    );

    const result = await createCreatePullRequestTool(makeContext()).execute(
      args,
      "",
    );

    expect(String(result)).toContain("401");
    expect(String(result)).not.toContain(TOKEN);
    expect(redisMock.deleteCache).toHaveBeenCalledWith(
      "github:access-token:user-1",
    );
  });

  it("maps a 404 to a branch-not-pushed error with recovery instructions", async () => {
    redisMock.getCache.mockResolvedValue(TOKEN);
    fetchMock.mockResolvedValue(githubRespond(404, { message: "Not Found" }));

    const result = await createCreatePullRequestTool(makeContext()).execute(
      args,
      "",
    );

    expect(result).toBe(
      "Error: GitHub repository 'octocat/hello-world' or branch 'fix-login'/'main' was not found, or you do not have access to it. create_pull_request only works when the head branch already exists on GitHub — implement the changes, commit them, and push 'fix-login' before calling this tool.",
    );
    expect(String(result)).not.toContain(TOKEN);
  });

  it("maps a 422 to a branch relationship validation error", async () => {
    redisMock.getCache.mockResolvedValue(TOKEN);
    fetchMock.mockResolvedValue(
      githubRespond(422, { message: "Validation Failed" }),
    );

    const result = await createCreatePullRequestTool(makeContext()).execute(
      args,
      "",
    );

    expect(String(result)).toContain("422");
    expect(String(result)).toContain("'head' and 'base'");
    expect(String(result)).not.toContain(TOKEN);
  });

  it("validates required arguments", async () => {
    const tool = createCreatePullRequestTool(makeContext());

    const missing = await tool.execute(
      { owner: "o", repo: "r", title: "t", head: "h" },
      "",
    );
    expect(missing).toBe(
      "Error: 'owner', 'repo', 'title', 'head' and 'base' are required and must be non-empty strings.",
    );

    const badBody = await tool.execute({ ...args, body: 42 }, "");
    expect(badBody).toBe("Error: 'body' must be a string.");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe("linked repository", () => {
    function linkedContext() {
      return { ...makeContext(), repositoryId: "repo-1" };
    }

    it("advertises owner, repo and base as optional when a repository is linked", () => {
      const tool = createCreatePullRequestTool(linkedContext());
      expect(tool.parameters.required).toEqual(["title", "head"]);
    });

    it("derives owner, repo and base from the linked repository", async () => {
      dbMock.repositoryRows = [
        { fullName: "octocat/hello-world", defaultBranch: "develop" },
      ];
      redisMock.getCache.mockResolvedValue(TOKEN);

      const tool = createCreatePullRequestTool(linkedContext());
      const result = await tool.execute(
        { title: "feat: add thing", head: "fix-login" },
        "",
      );

      expect(result).toEqual({
        pullRequestNumber: 7,
        url: "https://github.com/octocat/hello-world/pull/7",
        title: "fix: resolve login validation",
        state: "open",
        head: "fix-login",
        base: "main",
      });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      const [compareUrl] = fetchMock.mock.calls[0] as [string];
      expect(compareUrl).toBe(
        "https://api.github.com/repos/octocat/hello-world/compare/develop...fix-login",
      );
      const [prUrl, prInit] = fetchMock.mock.calls[1] as [string, RequestInit];
      expect(prUrl).toBe("https://api.github.com/repos/octocat/hello-world/pulls");
      expect(JSON.parse(prInit.body as string)).toEqual({
        title: "feat: add thing",
        head: "fix-login",
        base: "develop",
      });
    });

    it("rejects owner or repo values that differ from the linked repository", async () => {
      dbMock.repositoryRows = [
        { fullName: "octocat/hello-world", defaultBranch: "main" },
      ];
      redisMock.getCache.mockResolvedValue(TOKEN);

      const result = await createCreatePullRequestTool(linkedContext()).execute(
        { owner: "user", repo: "auth-app", title: "t", head: "h", base: "main" },
        "",
      );

      expect(String(result)).toContain(
        "linked to repository 'octocat/hello-world'",
      );
      expect(String(result)).toContain("expected owner 'octocat'");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("falls back to strict arguments when the linked repository row is missing", async () => {
      dbMock.repositoryRows = [];
      redisMock.getCache.mockResolvedValue(TOKEN);

      const result = await createCreatePullRequestTool(linkedContext()).execute(
        { title: "t", head: "h" },
        "",
      );

      expect(result).toBe(
        "Error: 'owner', 'repo', 'title', 'head' and 'base' are required and must be non-empty strings.",
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("uses an explicitly provided base branch", async () => {
      dbMock.repositoryRows = [
        { fullName: "octocat/hello-world", defaultBranch: "main" },
      ];
      redisMock.getCache.mockResolvedValue(TOKEN);

      await createCreatePullRequestTool(linkedContext()).execute(
        { title: "t", head: "fix-login", base: "release" },
        "",
      );

      const [compareUrl] = fetchMock.mock.calls[0] as [string];
      expect(compareUrl).toContain("/compare/release...fix-login");
    });
  });
});
