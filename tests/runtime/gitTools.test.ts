import { describe, it, expect, beforeEach, vi } from "vitest";

const computeMocks = vi.hoisted(() => ({
    connectSbx: vi.fn(),
}));

vi.mock("@klinpi/compute", () => ({
    sandboxManger: { connectSbx: computeMocks.connectSbx },
}));

const redisMock = vi.hoisted(() => ({
    getCache: vi.fn(),
    setCache: vi.fn(),
    deleteCache: vi.fn(),
}));

const dbMock = vi.hoisted(() => ({
    rows: [] as Array<{ accessToken: string | null }>,
    getDb: vi.fn(),
}));

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

import { git_branch } from "../../packages/runtime/src/tools/git_tools/git_branch.js";
import { git_status } from "../../packages/runtime/src/tools/git_tools/git_status.js";
import { git_diff } from "../../packages/runtime/src/tools/git_tools/git_diff.js";
import { git_stage } from "../../packages/runtime/src/tools/git_tools/git_stage.js";
import { createGitCommitTool } from "../../packages/runtime/src/tools/git_tools/git_commit.js";
import { createGitPushTool } from "../../packages/runtime/src/tools/git_tools/git_push.js";
import { run_command } from "../../packages/runtime/src/tools/run_command.js";
import type { ToolContext } from "../../packages/runtime/src/types.js";
import { createRunWorkflowState } from "../../packages/runtime/src/lib/workflowState.js";

const TOKEN = "gho_SuperSecretToken123abcDEF";
const REPO_CHECK = /test -d \/workspace\/\.git/;

function makeContext(userId = "user-1"): ToolContext {
    return {
        memoryService: {} as ToolContext["memoryService"],
        userId,
        sessionId: "session-1",
        repositoryId: null,
        workflow: createRunWorkflowState(),
    };
}

function makeDb() {
    const limit = vi.fn(() => Promise.resolve(dbMock.rows));
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    return { select, from, where, limit };
}

type CommandResponse = { exitCode: number; stdout: string; stderr: string };

function ok(stdout = ""): CommandResponse {
    return { exitCode: 0, stdout, stderr: "" };
}

function fail(stderr: string, exitCode = 1): never {
    throw Object.assign(new Error("command failed"), {
        exitCode,
        stdout: "",
        stderr,
    });
}

type Handler = [RegExp, () => CommandResponse | never];

function installRun(handlers: Handler[]) {
    const run = vi.fn(async (cmd: string): Promise<CommandResponse> => {
        for (const [pattern, respond] of handlers) {
            if (pattern.test(cmd)) {
                return respond();
            }
        }
        return { exitCode: 127, stdout: "", stderr: `unhandled command: ${cmd}` };
    });
    computeMocks.connectSbx.mockReset().mockResolvedValue({ commands: { run } });
    return run;
}

describe("git tools", () => {
    beforeEach(() => {
        redisMock.getCache.mockReset().mockResolvedValue(null);
        redisMock.setCache.mockReset().mockResolvedValue(undefined);
        redisMock.deleteCache.mockReset().mockResolvedValue(undefined);
        dbMock.rows = [];
        dbMock.getDb.mockReset().mockReturnValue(makeDb());
        computeMocks.connectSbx.mockReset();
    });

    describe("git_branch", () => {
        it("creates and switches to a new branch", async () => {
            const run = installRun([
                [REPO_CHECK, () => ok("HAS_REPO\n")],
                [/^git checkout -b/, () => ok("")],
                [/rev-parse --abbrev-ref HEAD/, () => ok("feat/x\n")],
            ]);

            const result = await git_branch.execute({ branch: "feat/x" }, "sbx-1");

            expect(String(result)).toContain("Created and switched to branch 'feat/x'");
            expect(run).toHaveBeenCalledWith("git checkout -b 'feat/x'", {
                cwd: "/workspace",
            });
        });

        it("switches to an existing branch when create is false", async () => {
            const run = installRun([
                [REPO_CHECK, () => ok("HAS_REPO\n")],
                [/^git checkout /, () => ok("")],
                [/rev-parse --abbrev-ref HEAD/, () => ok("fix/y\n")],
            ]);

            const result = await git_branch.execute(
                { branch: "fix/y", create: false },
                "sbx-1",
            );

            expect(String(result)).toContain("Switched to branch 'fix/y'");
            expect(run).toHaveBeenCalledWith("git checkout 'fix/y'", {
                cwd: "/workspace",
            });
        });

        it("suggests create=false when the branch already exists", async () => {
            installRun([
                [REPO_CHECK, () => ok("HAS_REPO\n")],
                [
                    /^git checkout -b/,
                    () => fail("fatal: a branch named 'feat/x' already exists"),
                ],
            ]);

            const result = await git_branch.execute({ branch: "feat/x" }, "sbx-1");

            expect(String(result)).toContain("already exists");
            expect(String(result)).toContain("create=false");
        });

        it("rejects invalid branch names without touching the sandbox", async () => {
            const result = await git_branch.execute(
                { branch: "feat/../evil; rm -rf /" },
                "sbx-1",
            );

            expect(String(result)).toContain("not a valid branch name");
            expect(computeMocks.connectSbx).not.toHaveBeenCalled();
        });

        it("returns an error when no sandbox is available", async () => {
            const result = await git_branch.execute({ branch: "feat/x" }, "");
            expect(String(result)).toContain("No sandbox available");
        });
    });

    describe("git_status", () => {
        it("returns porcelain status with the branch header", async () => {
            const run = installRun([
                [REPO_CHECK, () => ok("HAS_REPO\n")],
                [/git status --porcelain/, () => ok("## main\n M src/app.ts\n")],
            ]);

            const result = await git_status.execute({}, "sbx-1");

            expect(String(result)).toContain("## main");
            expect(String(result)).toContain("M src/app.ts");
            expect(run).toHaveBeenCalledWith("git status --porcelain=v1 --branch", {
                cwd: "/workspace",
            });
        });

        it("reports a clean working tree", async () => {
            installRun([
                [REPO_CHECK, () => ok("HAS_REPO\n")],
                [/git status --porcelain/, () => ok("")],
            ]);

            const result = await git_status.execute({}, "sbx-1");
            expect(String(result)).toContain("(working tree clean)");
        });
    });

    describe("git_diff", () => {
        it("diffs against HEAD by default", async () => {
            const run = installRun([
                [REPO_CHECK, () => ok("HAS_REPO\n")],
                [/git diff HEAD/, () => ok("diff --git a/x b/x\n+hello")],
            ]);

            const result = await git_diff.execute({}, "sbx-1");

            expect(String(result)).toContain("+hello");
            expect(run).toHaveBeenCalledWith("git diff HEAD", { cwd: "/workspace" });
        });

        it("diffs staged changes when staged=true", async () => {
            const run = installRun([
                [REPO_CHECK, () => ok("HAS_REPO\n")],
                [/git diff --cached$/, () => ok("diff --git a/y b/y\n+staged")],
            ]);

            const result = await git_diff.execute({ staged: true }, "sbx-1");

            expect(String(result)).toContain("+staged");
            expect(run).toHaveBeenCalledWith("git diff --cached", {
                cwd: "/workspace",
            });
        });

        it("reports when there are no changes", async () => {
            installRun([
                [REPO_CHECK, () => ok("HAS_REPO\n")],
                [/git diff HEAD/, () => ok("")],
            ]);

            const result = await git_diff.execute({}, "sbx-1");
            expect(String(result)).toContain("No changes");
        });
    });

    describe("git_stage", () => {
        it("stages the given paths", async () => {
            const run = installRun([
                [REPO_CHECK, () => ok("HAS_REPO\n")],
                [/^git add/, () => ok("")],
                [/git diff --cached --stat/, () => ok(" src/app.ts | 4 ++++\n")],
            ]);

            const result = await git_stage.execute(
                { paths: ["src/app.ts", "."] },
                "sbx-1",
            );

            expect(String(result)).toContain("Staged: src/app.ts, .");
            expect(run).toHaveBeenCalledWith("git add -- 'src/app.ts' '.'", {
                cwd: "/workspace",
            });
        });

        it("shell-quotes paths containing quotes", async () => {
            const run = installRun([
                [REPO_CHECK, () => ok("HAS_REPO\n")],
                [/^git add/, () => ok("")],
                [/git diff --cached --stat/, () => ok("")],
            ]);

            await git_stage.execute({ paths: ["don't.txt"] }, "sbx-1");

            expect(run).toHaveBeenCalledWith(`git add -- 'don'\\''t.txt'`, {
                cwd: "/workspace",
            });
        });

        it("rejects an empty paths array", async () => {
            const result = await git_stage.execute({ paths: [] }, "sbx-1");
            expect(String(result)).toContain("non-empty array");
        });

        it("normalizes absolute /workspace paths to repository-relative paths", async () => {
            const run = installRun([
                [REPO_CHECK, () => ok("HAS_REPO\n")],
                [/^git add/, () => ok("")],
                [/git diff --cached --stat/, () => ok(" user_auth.py | 10 +++++++++\n")],
            ]);

            const result = await git_stage.execute(
                { paths: ["/workspace/user_auth.py"] },
                "sbx-1",
            );

            expect(run).toHaveBeenCalledWith("git add -- 'user_auth.py'", {
                cwd: "/workspace",
            });
            expect(String(result)).toContain("Staged: user_auth.py");
        });
    });

    describe("git_commit", () => {
        it("refuses to commit when nothing is staged", async () => {
            installRun([
                [REPO_CHECK, () => ok("HAS_REPO\n")],
                [/git config user/, () => ok("")],
                [/git diff --cached --quiet/, () => ok("")],
                [/git status --porcelain/, () => ok(" M docs/readme.md\n")],
            ]);

            const result = await createGitCommitTool(makeContext()).execute(
                { message: "feat: add docs" },
                "sbx-1",
            );

            expect(String(result)).toContain("nothing is staged");
            expect(String(result)).toContain("git_stage");
        });

        it("refuses to commit when the working tree is clean", async () => {
            installRun([
                [REPO_CHECK, () => ok("HAS_REPO\n")],
                [/git config user/, () => ok("")],
                [/git diff --cached --quiet/, () => ok("")],
                [/git status --porcelain/, () => ok("")],
            ]);

            const result = await createGitCommitTool(makeContext()).execute(
                { message: "feat: add docs" },
                "sbx-1",
            );

            expect(String(result)).toContain("nothing to commit");
        });

        it("creates a commit from staged changes and returns the real hash", async () => {
            const run = installRun([
                [REPO_CHECK, () => ok("HAS_REPO\n")],
                [/git config user/, () => ok("")],
                [/git diff --cached --quiet/, () => fail("", 1)],
                [/^git commit/, () => ok(" [main abc1234] feat: add docs\n")],
                [/git log -1/, () => ok("abc1234def567890\nfeat: add docs\n")],
            ]);

            const result = await createGitCommitTool(makeContext()).execute(
                { message: "feat: add docs" },
                "sbx-1",
            );

            expect(String(result)).toContain("Created commit abc1234def567890");
            expect(String(result)).toContain("Push the branch with git_push");
            expect(run).toHaveBeenCalledWith("git commit -m 'feat: add docs'", {
                cwd: "/workspace",
            });
        });

        it("rejects an empty message", async () => {
            const result = await createGitCommitTool(makeContext()).execute({ message: "  " }, "sbx-1");
            expect(String(result)).toContain("'message' must be a non-empty string");
        });

        it("records the commit on the run workflow state", async () => {
            installRun([
                [REPO_CHECK, () => ok("HAS_REPO\n")],
                [/git config user/, () => ok("")],
                [/git diff --cached --quiet/, () => fail("", 1)],
                [/^git commit/, () => ok(" [main abc1234] feat: add docs\n")],
                [/git log -1/, () => ok("abc1234def567890\nfeat: add docs\n")],
            ]);

            const context = makeContext();
            await createGitCommitTool(context).execute(
                { message: "feat: add docs" },
                "sbx-1",
            );

            expect(context.workflow.commits).toBe(1);
        });

        it("does not record the commit when the commit fails", async () => {
            installRun([
                [REPO_CHECK, () => ok("HAS_REPO\n")],
                [/git config user/, () => ok("")],
                [/git diff --cached --quiet/, () => fail("", 1)],
                [/^git commit/, () => fail("error: hook declined")],
            ]);

            const context = makeContext();
            await createGitCommitTool(context).execute(
                { message: "feat: add docs" },
                "sbx-1",
            );

            expect(context.workflow.commits).toBe(0);
        });
    });

    describe("git_push", () => {
        it("pushes the current branch with an authenticated remote and sanitizes output", async () => {
            redisMock.getCache.mockResolvedValue(TOKEN);
            const run = installRun([
                [REPO_CHECK, () => ok("HAS_REPO\n")],
                [/rev-parse --abbrev-ref HEAD/, () => ok("feat/x\n")],
                [/remote get-url/, () => ok("https://github.com/octo/repo.git\n")],
                [/remote set-url .*x-access-token/, () => ok("")],
                [/^git push/, () => ok("To github.com/octo/repo.git\n   new..old  feat/x -> feat/x\n")],
                [/remote set-url/, () => ok("")],
            ]);

            const tool = createGitPushTool(makeContext());
            const result = await tool.execute({}, "sbx-1");

            expect(String(result)).toContain("Pushed branch 'feat/x' to 'origin'");
            expect(String(result)).toContain("create_pull_request may be called");
            expect(String(result)).not.toContain(TOKEN);

            const commands = run.mock.calls.map((call) => String(call[0]));
            expect(commands).toContain(
                `git push -u 'origin' 'HEAD:refs/heads/feat/x'`,
            );
            const swap = commands.find((c) => c.includes("x-access-token"));
            expect(swap).toContain(`x-access-token:${TOKEN}@github.com/octo/repo.git`);
            const restore = commands.filter((c) => c.startsWith("git remote set-url"));
            expect(restore[restore.length - 1]).toContain(
                "https://github.com/octo/repo.git",
            );
        });

        it("warns when pushing a default branch", async () => {
            redisMock.getCache.mockResolvedValue(TOKEN);
            installRun([
                [REPO_CHECK, () => ok("HAS_REPO\n")],
                [/rev-parse --abbrev-ref HEAD/, () => ok("main\n")],
                [/remote get-url/, () => ok("https://github.com/octo/repo.git\n")],
                [/remote set-url .*x-access-token/, () => ok("")],
                [/^git push/, () => ok("Everything up-to-date\n")],
                [/remote set-url/, () => ok("")],
            ]);

            const result = await createGitPushTool(makeContext()).execute({}, "sbx-1");
            expect(String(result)).toContain("Warning: this is a default branch");
        });

        it("blocks the push when no GitHub credentials exist", async () => {
            dbMock.rows = [{ accessToken: null }];
            const run = installRun([
                [REPO_CHECK, () => ok("HAS_REPO\n")],
                [/rev-parse --abbrev-ref HEAD/, () => ok("feat/x\n")],
                [/remote get-url/, () => ok("https://github.com/octo/repo.git\n")],
            ]);

            const result = await createGitPushTool(makeContext()).execute({}, "sbx-1");

            expect(String(result)).toContain("cannot push without GitHub credentials");
            expect(String(result)).toContain("no GitHub account is connected");
            expect(run.mock.calls.some((c) => String(c[0]).startsWith("git push"))).toBe(
                false,
            );
        });

        it("reports push failures with explicit create_pull_request guidance", async () => {
            redisMock.getCache.mockResolvedValue(TOKEN);
            installRun([
                [REPO_CHECK, () => ok("HAS_REPO\n")],
                [/rev-parse --abbrev-ref HEAD/, () => ok("feat/x\n")],
                [/remote get-url/, () => ok("https://github.com/octo/repo.git\n")],
                [/remote set-url .*x-access-token/, () => ok("")],
                [/^git push/, () => fail("error: failed to push some refs to 'origin'")],
                [/remote set-url/, () => ok("")],
            ]);

            const result = await createGitPushTool(makeContext()).execute({}, "sbx-1");

            expect(String(result)).toContain("Error pushing branch 'feat/x'");
            expect(String(result)).toContain("Do not call create_pull_request");
            expect(String(result)).not.toContain(TOKEN);
        });

        it("fails clearly when the workspace has no remote", async () => {
            installRun([
                [REPO_CHECK, () => ok("HAS_REPO\n")],
                [/rev-parse --abbrev-ref HEAD/, () => ok("feat/x\n")],
                [/remote get-url/, () => fail("fatal: no such remote: origin")],
            ]);

            const result = await createGitPushTool(makeContext()).execute({}, "sbx-1");
            expect(String(result)).toContain("no remote 'origin' is configured");
        });

        it("pushes an explicitly provided local branch", async () => {
            redisMock.getCache.mockResolvedValue(TOKEN);
            const run = installRun([
                [REPO_CHECK, () => ok("HAS_REPO\n")],
                [/show-ref --verify/, () => ok("")],
                [/remote get-url/, () => ok("https://github.com/octo/repo.git\n")],
                [/remote set-url .*x-access-token/, () => ok("")],
                [/^git push/, () => ok("pushed\n")],
                [/remote set-url/, () => ok("")],
            ]);

            const result = await createGitPushTool(makeContext()).execute(
                { branch: "feature/user-auth" },
                "sbx-1",
            );

            expect(String(result)).toContain("Pushed branch 'feature/user-auth'");
            const commands = run.mock.calls.map((call) => String(call[0]));
            expect(commands).toContain(
                "git push -u 'origin' 'refs/heads/feature/user-auth'",
            );
            expect(
                commands.some((c) => c.includes("rev-parse --abbrev-ref")),
            ).toBe(false);
        });

        it("fails when the requested branch does not exist locally", async () => {
            const run = installRun([
                [REPO_CHECK, () => ok("HAS_REPO\n")],
                [/show-ref --verify/, () => fail("", 1)],
            ]);

            const result = await createGitPushTool(makeContext()).execute(
                { branch: "nope" },
                "sbx-1",
            );

            expect(String(result)).toContain("local branch 'nope' does not exist");
            expect(
                run.mock.calls.some((c) => String(c[0]).startsWith("git push")),
            ).toBe(false);
        });

        it("records the push snapshot so create_pull_request knows changes reached GitHub", async () => {
            redisMock.getCache.mockResolvedValue(TOKEN);
            installRun([
                [REPO_CHECK, () => ok("HAS_REPO\n")],
                [/rev-parse --abbrev-ref HEAD/, () => ok("feat/x\n")],
                [/remote get-url/, () => ok("https://github.com/octo/repo.git\n")],
                [/remote set-url .*x-access-token/, () => ok("")],
                [/^git push/, () => ok("pushed\n")],
                [/remote set-url/, () => ok("")],
            ]);

            const context = makeContext();
            context.workflow.writeCount = 2;

            await createGitPushTool(context).execute({}, "sbx-1");

            expect(context.workflow.writesAtLastPush).toBe(2);
            expect(context.workflow.pushedBranches.has("feat/x")).toBe(true);
        });

        it("does not record the snapshot when the push fails", async () => {
            redisMock.getCache.mockResolvedValue(TOKEN);
            installRun([
                [REPO_CHECK, () => ok("HAS_REPO\n")],
                [/rev-parse --abbrev-ref HEAD/, () => ok("feat/x\n")],
                [/remote get-url/, () => ok("https://github.com/octo/repo.git\n")],
                [/remote set-url .*x-access-token/, () => ok("")],
                [/^git push/, () => fail("error: failed to push some refs to 'origin'")],
                [/remote set-url/, () => ok("")],
            ]);

            const context = makeContext();
            context.workflow.writeCount = 2;

            await createGitPushTool(context).execute({}, "sbx-1");

            expect(context.workflow.writesAtLastPush).toBe(0);
            expect(context.workflow.pushedBranches.size).toBe(0);
        });

        it("rejects an invalid branch argument before touching the sandbox", async () => {
            const result = await createGitPushTool(makeContext()).execute(
                { branch: "bad;rm -rf" },
                "sbx-1",
            );

            expect(String(result)).toContain("invalid 'branch'");
            expect(computeMocks.connectSbx).not.toHaveBeenCalled();
        });
    });

    describe("run_command", () => {
        it("runs the command in /workspace and reports the exit code", async () => {
            const run = installRun([[/npm test/, () => ok("PASS\n")]]);

            const result = await run_command.execute({ command: "npm test" }, "sbx-1");

            expect(String(result)).toContain("Exit code: 0");
            expect(String(result)).toContain("PASS");
            expect(run).toHaveBeenCalledWith("npm test", { cwd: "/workspace" });
        });

        it("resolves relative cwd against /workspace", async () => {
            const run = installRun([[/tsc/, () => ok("")]]);

            await run_command.execute(
                { command: "tsc --noEmit", cwd: "packages/runtime" },
                "sbx-1",
            );

            expect(run).toHaveBeenCalledWith("tsc --noEmit", {
                cwd: "/workspace/packages/runtime",
            });
        });

        it("scrubs credential patterns from command output", async () => {
            installRun([
                [
                    /git remote -v/,
                    () => ok("origin https://x-access-token:secret123@github.com/o/r.git\n"),
                ],
            ]);

            const result = await run_command.execute(
                { command: "git remote -v" },
                "sbx-1",
            );

            expect(String(result)).toContain("x-access-token:***@github.com");
            expect(String(result)).not.toContain("secret123");
        });

        it("reports stderr and non-zero exit codes", async () => {
            installRun([[/pytest/, () => fail("FAILED tests/test_a.py", 1)]]);

            const result = await run_command.execute({ command: "pytest" }, "sbx-1");
            expect(String(result)).toContain("Exit code: 1");
            expect(String(result)).toContain("FAILED tests/test_a.py");
        });

        it("rejects an empty command", async () => {
            const result = await run_command.execute({ command: " " }, "sbx-1");
            expect(String(result)).toContain("'command' must be a non-empty string");
        });

        it("refuses shell redirection into the repository", async () => {
            const run = installRun([]);

            const result = await run_command.execute(
                { command: "echo 'FROM node:20' > Dockerfile" },
                "sbx-1",
            );

            expect(String(result)).toContain("must not create or modify repository files");
            expect(String(result)).toContain("/workspace/Dockerfile");
            expect(String(result)).toContain("read_file");
            expect(String(result)).toContain("edit_file");
            expect(run).not.toHaveBeenCalled();
        });

        it("refuses append redirection into an absolute repository path", async () => {
            const run = installRun([]);

            const result = await run_command.execute(
                { command: "cat notes.txt >> /workspace/CHANGELOG.md" },
                "sbx-1",
            );

            expect(String(result)).toContain("/workspace/CHANGELOG.md");
            expect(run).not.toHaveBeenCalled();
        });

        it("refuses tee and in-place sed writes into the repository", async () => {
            const teeRun = installRun([]);
            const teeResult = await run_command.execute(
                { command: "printf 'x' | tee /workspace/config.json" },
                "sbx-1",
            );
            expect(String(teeResult)).toContain("/workspace/config.json");
            expect(teeRun).not.toHaveBeenCalled();

            const sedRun = installRun([]);
            const sedResult = await run_command.execute(
                { command: "sed -i 's/a/b/' app.js" },
                "sbx-1",
            );
            expect(String(sedResult)).toContain("/workspace/app.js");
            expect(sedRun).not.toHaveBeenCalled();
        });

        it("allows redirection to paths outside the repository", async () => {
            const run = installRun([[/npm test/, () => ok("PASS\n")]]);

            const result = await run_command.execute(
                { command: "npm test > /tmp/test-output.log 2>&1" },
                "sbx-1",
            );

            expect(String(result)).toContain("Exit code: 0");
            expect(run).toHaveBeenCalledWith("npm test > /tmp/test-output.log 2>&1", {
                cwd: "/workspace",
            });
        });

        it("resolves relative redirect targets against the command cwd", async () => {
            const run = installRun([]);

            const result = await run_command.execute(
                { command: "echo hi > build.log", cwd: "packages/runtime" },
                "sbx-1",
            );

            expect(String(result)).toContain("/workspace/packages/runtime/build.log");
            expect(run).not.toHaveBeenCalled();

            const tmpRun = installRun([[/echo/, () => ok("hi\n")]]);
            await run_command.execute(
                { command: "echo hi > build.log", cwd: "/tmp" },
                "sbx-1",
            );
            expect(tmpRun).toHaveBeenCalledWith("echo hi > build.log", { cwd: "/tmp" });
        });

        it("does not treat a '>' inside a commit message as a file write", async () => {
            const run = installRun([[/git commit/, () => ok("committed\n")]]);

            const result = await run_command.execute(
                { command: "git commit -m 'Handle status > 0 responses'" },
                "sbx-1",
            );

            expect(String(result)).toContain("Exit code: 0");
            expect(run).toHaveBeenCalled();
        });
    });
});
