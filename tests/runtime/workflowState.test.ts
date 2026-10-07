import { describe, it, expect } from "vitest";
import {
    createRunWorkflowState,
    missingWorkflowSteps,
    nextStepDirective,
    isRepositoryPath,
    WORKSPACE_ROOT,
} from "../../packages/runtime/src/lib/workflowState.js";
import type { RunWorkflowState } from "../../packages/runtime/src/lib/workflowState.js";

const FULL_TASK =
    "Add a Dockerfile to this repository, commit it, push the branch, and open a PR";

describe("createRunWorkflowState", () => {
    it("starts with nothing done", () => {
        const state = createRunWorkflowState();

        expect(state).toEqual({
            inspected: false,
            readPaths: new Set(),
            writtenPaths: new Set(),
            writeCount: 0,
            writesAtLastPush: 0,
            pushedBranches: new Set(),
            commits: 0,
            prCreated: false,
            issueOps: 0,
        });
    });
});

describe("missingWorkflowSteps", () => {
    it("reports every unfinished step of a full implementation task", () => {
        const missing = missingWorkflowSteps(
            FULL_TASK,
            createRunWorkflowState(),
        );

        expect(missing).toHaveLength(4);
        expect(missing.join("\n")).toContain("file change has not been made");
        expect(missing.join("\n")).toContain("have not been committed");
        expect(missing.join("\n")).toContain("has not been pushed");
        expect(missing.join("\n")).toContain("pull request has not been opened");
    });

    it("returns nothing once every requested step is done", () => {
        const state = createRunWorkflowState();
        state.writeCount = 1;
        state.commits = 1;
        state.pushedBranches.add("feat/dockerfile");
        state.prCreated = true;

        expect(missingWorkflowSteps(FULL_TASK, state)).toEqual([]);
    });

    it("reports only the steps that are still outstanding", () => {
        const state = createRunWorkflowState();
        state.writeCount = 1;
        state.commits = 1;

        const missing = missingWorkflowSteps(FULL_TASK, state);

        expect(missing).toHaveLength(2);
        expect(missing[0]).toContain("has not been pushed");
        expect(missing[1]).toContain("pull request has not been opened");
    });

    it("asks for the file change when the task never reached a commit", () => {
        const missing = missingWorkflowSteps(
            "Add a healthcheck endpoint",
            createRunWorkflowState(),
        );

        expect(missing).toHaveLength(1);
        expect(missing[0]).toContain("file change has not been made");
    });

    it("stays silent for read-only questions", () => {
        expect(
            missingWorkflowSteps(
                "Why did my push fail?",
                createRunWorkflowState(),
            ),
        ).toEqual([]);
        expect(
            missingWorkflowSteps(
                "Explain the build",
                createRunWorkflowState(),
            ),
        ).toEqual([]);
        expect(
            missingWorkflowSteps(
                "Read the file and tell me what it does",
                createRunWorkflowState(),
            ),
        ).toEqual([]);
    });

    it("stays silent for non-task statements", () => {
        expect(
            missingWorkflowSteps(
                "The build is broken",
                createRunWorkflowState(),
            ),
        ).toEqual([]);
    });

    it("stays silent when the write was explicitly negated", () => {
        expect(
            missingWorkflowSteps(
                "Please don't modify anything, just explain the architecture",
                createRunWorkflowState(),
            ),
        ).toEqual([]);
    });

    it("stays silent for tasks with no write/commit/push/PR intent", () => {
        expect(
            missingWorkflowSteps(
                "Run the tests and tell me if they pass",
                createRunWorkflowState(),
            ),
        ).toEqual([]);
    });

    it("never treats a GitHub issue request as an unfinished file change", () => {
        const issuePrompts = [
            "create new issue on this repo bro about redisign the UI",
            "create an issue about redesigning the UI",
            "Create an issue saying the UI needs redesign.",
            "delete this issue",
            "close issue #10.",
            "update the issue title to Fix login",
            "create a branch called feat/x",
        ];

        for (const prompt of issuePrompts) {
            expect(
                missingWorkflowSteps(prompt, createRunWorkflowState()),
                `expected no gaps for: ${prompt}`,
            ).toEqual([]);
        }
    });

    it("never demands a file change for a PR-only request", () => {
        const missing = missingWorkflowSteps(
            "create a pull request for my changes",
            createRunWorkflowState(),
        );

        expect(missing).toHaveLength(1);
        expect(missing[0]).toContain("pull request has not been opened");
        expect(missing.join("\n")).not.toContain("file change");
    });

    it("still tracks file changes when a code task also mentions an issue", () => {
        const missing = missingWorkflowSteps(
            "Add a Dockerfile to this repository and open an issue about it",
            createRunWorkflowState(),
        );

        expect(missing).toHaveLength(1);
        expect(missing[0]).toContain("file change has not been made");
    });

    describe("issue-task latch", () => {
        const BUG_REPORT = "create a bug report about the broken build";

        it("reports the classifier gap while no issue operation has succeeded", () => {
            const missing = missingWorkflowSteps(
                BUG_REPORT,
                createRunWorkflowState(),
            );

            expect(missing).toHaveLength(1);
            expect(missing[0]).toContain("file change has not been made");
        });

        it("goes silent once a GitHub issue operation succeeded with no repository work", () => {
            const state = createRunWorkflowState();
            state.issueOps = 1;

            expect(missingWorkflowSteps(BUG_REPORT, state)).toEqual([]);
            expect(nextStepDirective(BUG_REPORT, state)).toBeNull();
        });

        it("suppresses every gap for an issue-side prompt once an issue op succeeded", () => {
            const state = createRunWorkflowState();
            state.issueOps = 1;

            expect(
                missingWorkflowSteps(
                    "create a bug report about the broken build and commit the fix",
                    state,
                ),
            ).toEqual([]);
        });

        it("stays inactive once repository work has started", () => {
            const state = createRunWorkflowState();
            state.issueOps = 1;
            state.writeCount = 1;
            state.commits = 1;

            const missing = missingWorkflowSteps(FULL_TASK, state);

            expect(missing).toHaveLength(2);
            expect(missing[0]).toContain("has not been pushed");
            expect(missing[1]).toContain("pull request has not been opened");
        });

        it("stays inactive when no issue operation happened", () => {
            const missing = missingWorkflowSteps(
                BUG_REPORT,
                createRunWorkflowState(),
            );

            expect(missing).toHaveLength(1);
        });
    });

    it("treats a mid-prompt instruction as part of the task", () => {
        const missing = missingWorkflowSteps(
            "The tests are red. Fix the failing test and push the fix.",
            createRunWorkflowState(),
        );

        expect(missing.join("\n")).toContain("file change has not been made");
        expect(missing.join("\n")).toContain("has not been pushed");
        expect(missing.join("\n")).not.toContain("committed");
        expect(missing.join("\n")).not.toContain("pull request");
    });
});

describe("isRepositoryPath", () => {
    it("accepts the workspace root and its children only", () => {
        expect(isRepositoryPath(WORKSPACE_ROOT)).toBe(true);
        expect(isRepositoryPath(`${WORKSPACE_ROOT}/src/app.ts`)).toBe(true);
        expect(isRepositoryPath("/etc/passwd")).toBe(false);
        expect(isRepositoryPath("/home/user/project")).toBe(false);
    });
});

describe("nextStepDirective", () => {
    it("points at the inspect → read → edit chain before anything is written", () => {
        const directive = nextStepDirective(
            FULL_TASK,
            createRunWorkflowState(),
        );

        expect(directive).toContain("list_files");
        expect(directive).toContain('{"path":"/workspace"}');
        expect(directive).toContain("edit_file");
    });

    it("points at git_stage → git_commit once the file change exists", () => {
        const state = createRunWorkflowState();
        state.writeCount = 1;

        const directive = nextStepDirective(FULL_TASK, state);

        expect(directive).toContain("git_stage");
        expect(directive).toContain("git_commit");
        expect(directive).not.toContain("list_files");
    });

    it("points at git_push after a commit", () => {
        const state = createRunWorkflowState();
        state.writeCount = 1;
        state.commits = 1;

        expect(nextStepDirective(FULL_TASK, state)).toContain("git_push");
    });

    it("points at create_pull_request after a push", () => {
        const state = createRunWorkflowState();
        state.writeCount = 1;
        state.commits = 1;
        state.pushedBranches.add("feat/dockerfile");

        expect(nextStepDirective(FULL_TASK, state)).toContain(
            "create_pull_request",
        );
    });

    it("is null once every requested step is done", () => {
        const state = createRunWorkflowState();
        state.writeCount = 1;
        state.commits = 1;
        state.pushedBranches.add("feat/dockerfile");
        state.prCreated = true;

        expect(nextStepDirective(FULL_TASK, state)).toBeNull();
    });

    it("is null for read-only questions", () => {
        expect(
            nextStepDirective("Why did my push fail?", createRunWorkflowState()),
        ).toBeNull();
    });
});
