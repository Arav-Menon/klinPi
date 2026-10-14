import { describe, it, expect, vi } from "vitest";

import {
    authorizeToolCall,
    deriveTaskScope,
    fullTaskScope,
    recordMutationOutcome,
    selectToolsForScope,
} from "../../packages/runtime/src/lib/taskScope.js";
import type { AgentTool } from "../../packages/runtime/src/types.js";

function taggedTool(
    name: string,
    capabilities: AgentTool["capabilities"],
): AgentTool {
    return {
        name,
        description: `${name} for tests`,
        capabilities,
        parameters: { type: "object", properties: {}, required: [] },
        execute: vi.fn().mockResolvedValue("ok"),
    };
}

const createIssue = () =>
    taggedTool("create_issue", ["github.create_issue"]);
const updateIssue = () =>
    taggedTool("update_issue", ["github.update_issue"]);
const closeIssue = () =>
    taggedTool("close_issue", ["github.close_issue"]);
const createPr = () => taggedTool("create_pull_request", ["github.create_pr"]);
const readFile = () => taggedTool("read_file", ["fs.read"]);
const editFile = () => taggedTool("edit_file", ["fs.write"]);
const gitPush = () => taggedTool("git_push", ["git.push"]);
const runCommand = () => taggedTool("run_command", ["shell"]);

describe("deriveTaskScope", () => {
    it("grants a README-summary request inspection only — no mutations, no writes", () => {
        const scope = deriveTaskScope(
            "Summarize this repository's README.",
        );
        expect(scope.capabilities.has("fs.read")).toBe(true);
        expect(scope.capabilities.has("github.read")).toBe(true);
        expect(scope.capabilities.has("fs.write")).toBe(false);
        expect(scope.capabilities.has("github.create_issue")).toBe(false);
        expect(scope.capabilities.has("github.update_issue")).toBe(false);
        expect(scope.capabilities.has("github.close_issue")).toBe(false);
        expect(scope.capabilities.has("github.create_pr")).toBe(false);
        expect(scope.capabilities.has("git.push")).toBe(false);
        expect(scope.budgets.createIssue.remaining).toBe(0);
        expect(scope.budgets.closeIssue.remaining).toBe(0);
    });

    it("grants exactly one issue creation for a create-one-issue request", () => {
        const scope = deriveTaskScope(
            "Create one GitHub issue to redesign the UI.",
        );
        expect(scope.capabilities.has("github.create_issue")).toBe(true);
        expect(scope.budgets.createIssue.remaining).toBe(1);
        expect(scope.capabilities.has("github.close_issue")).toBe(false);
        expect(scope.capabilities.has("github.update_issue")).toBe(false);
        expect(scope.budgets.closeIssue.remaining).toBe(0);
        expect(scope.budgets.updateIssue.remaining).toBe(0);
    });

    it("honors explicit cardinality words", () => {
        const scope = deriveTaskScope("Create two issues for the login bugs.");
        expect(scope.budgets.createIssue.remaining).toBe(2);
    });

    it("treats 'create a bug report' as issue creation", () => {
        const scope = deriveTaskScope(
            "create a bug report about the broken build",
        );
        expect(scope.capabilities.has("github.create_issue")).toBe(true);
        expect(scope.budgets.createIssue.remaining).toBe(1);
    });

    it("maps 'reopen issue #1' to update_issue with a pinned target, never create", () => {
        const scope = deriveTaskScope("Reopen issue #1.");
        expect(scope.capabilities.has("github.update_issue")).toBe(true);
        expect(scope.budgets.updateIssue.remaining).toBe(1);
        expect(scope.constraints.issueNumber).toBe(1);
        expect(scope.constraints.issueState).toBe("open");
        expect(scope.capabilities.has("github.create_issue")).toBe(false);
        expect(scope.budgets.createIssue.remaining).toBe(0);
    });

    it("maps 'open issue #1' (existing number) to a reopen, not a creation", () => {
        const scope = deriveTaskScope("Open issue #1 again please.");
        expect(scope.capabilities.has("github.update_issue")).toBe(true);
        expect(scope.constraints.issueNumber).toBe(1);
        expect(scope.budgets.createIssue.remaining).toBe(0);
    });

    it("still treats a number-free 'open an issue about X' as creation", () => {
        const scope = deriveTaskScope("Open an issue about the login bug.");
        expect(scope.capabilities.has("github.create_issue")).toBe(true);
        expect(scope.budgets.createIssue.remaining).toBe(1);
        expect(scope.budgets.updateIssue.remaining).toBe(0);
    });

    it("grants close_issue with a pinned number for 'close issue #2'", () => {
        const scope = deriveTaskScope("Close issue #2, it is fixed.");
        expect(scope.capabilities.has("github.close_issue")).toBe(true);
        expect(scope.budgets.closeIssue.remaining).toBe(1);
        expect(scope.constraints.issueNumber).toBe(2);
        expect(scope.budgets.createIssue.remaining).toBe(0);
    });

    it("grants local writes and git for a fix request but no external mutations", () => {
        const scope = deriveTaskScope("Fix the crash in login.ts");
        expect(scope.capabilities.has("fs.write")).toBe(true);
        expect(scope.capabilities.has("git.local")).toBe(true);
        expect(scope.capabilities.has("shell")).toBe(true);
        expect(scope.capabilities.has("github.create_issue")).toBe(false);
        expect(scope.capabilities.has("github.create_pr")).toBe(false);
        expect(scope.capabilities.has("git.push")).toBe(false);
    });

    it("grants push and PR for 'fix and open a pull request'", () => {
        const scope = deriveTaskScope(
            "Fix the bug and open a pull request",
        );
        expect(scope.capabilities.has("fs.write")).toBe(true);
        expect(scope.capabilities.has("git.push")).toBe(true);
        expect(scope.budgets.gitPush.remaining).toBe(1);
        expect(scope.capabilities.has("github.create_pr")).toBe(true);
        expect(scope.budgets.createPullRequest.remaining).toBe(1);
        expect(scope.capabilities.has("github.create_issue")).toBe(false);
    });

    it("grants a clone when the prompt carries a URL", () => {
        const scope = deriveTaskScope(
            "clone https://github.com/acme/app and look around",
        );
        expect(scope.capabilities.has("fs.write")).toBe(true);
        expect(scope.capabilities.has("shell")).toBe(true);
    });

    it("treats an ambiguous conversational prompt as read-only", () => {
        const scope = deriveTaskScope("What do you think about this?");
        expect(scope.capabilities.has("fs.read")).toBe(true);
        expect(scope.capabilities.has("fs.write")).toBe(false);
        expect(scope.capabilities.has("github.create_issue")).toBe(false);
        expect(scope.capabilities.has("git.push")).toBe(false);
    });
});

describe("selectToolsForScope", () => {
    it("offers only tools whose capabilities are in scope", () => {
        const scope = deriveTaskScope("Summarize this repository's README.");
        const registry = [
            readFile(),
            editFile(),
            createIssue(),
            updateIssue(),
            closeIssue(),
            createPr(),
            gitPush(),
            runCommand(),
        ];
        const offered = selectToolsForScope(registry, scope).map((t) => t.name);
        expect(offered).toEqual(["read_file"]);
    });

    it("offers mutation tools the scope authorizes", () => {
        const scope = deriveTaskScope("Create one GitHub issue about the UI.");
        const registry = [readFile(), editFile(), createIssue(), closeIssue()];
        const offered = selectToolsForScope(registry, scope).map((t) => t.name);
        expect(offered).toContain("create_issue");
        expect(offered).not.toContain("close_issue");
        expect(offered).not.toContain("edit_file");
    });

    it("always includes untagged tools (back-compat for ad-hoc tools)", () => {
        const scope = deriveTaskScope("Summarize the README.");
        const untagged: AgentTool = {
            name: "ad_hoc",
            description: "untagged",
            parameters: { type: "object", properties: {}, required: [] },
            execute: vi.fn(),
        };
        const offered = selectToolsForScope([untagged], scope);
        expect(offered.map((t) => t.name)).toEqual(["ad_hoc"]);
    });
});

describe("authorizeToolCall", () => {
    it("denies a mutation tool the scope never granted", () => {
        const scope = deriveTaskScope("Summarize this repository's README.");
        const decision = authorizeToolCall(
            createIssue(),
            { title: "x" },
            scope,
        );
        expect(decision.allowed).toBe(false);
    });

    it("allows the one authorized issue creation", () => {
        const scope = deriveTaskScope("Create one issue about the UI.");
        const decision = authorizeToolCall(
            createIssue(),
            { title: "Redesign the UI" },
            scope,
        );
        expect(decision.allowed).toBe(true);
    });

    it("denies a second create once the budget is consumed", () => {
        const scope = deriveTaskScope("Create one issue about the UI.");
        const tool = createIssue();
        recordMutationOutcome(scope, tool, true);
        const decision = authorizeToolCall(tool, { title: "again" }, scope);
        expect(decision.allowed).toBe(false);
        expect(decision.allowed === false && decision.reason).toContain(
            "budget",
        );
    });

    it("does not consume budget for a failed execution", () => {
        const scope = deriveTaskScope("Create one issue about the UI.");
        const tool = createIssue();
        recordMutationOutcome(scope, tool, false);
        expect(scope.budgets.createIssue.remaining).toBe(1);
        expect(authorizeToolCall(tool, { title: "retry" }, scope).allowed).toBe(
            true,
        );
    });

    it("denies close_issue entirely for a create-one-issue request", () => {
        const scope = deriveTaskScope("Create one issue about the UI.");
        const decision = authorizeToolCall(
            closeIssue(),
            { issueNumber: 42 },
            scope,
        );
        expect(decision.allowed).toBe(false);
    });

    it("pins reopen to the authorized issue number", () => {
        const scope = deriveTaskScope("Reopen issue #1.");
        const ok = authorizeToolCall(
            updateIssue(),
            { issueNumber: 1, state: "open" },
            scope,
        );
        expect(ok.allowed).toBe(true);
        const wrongTarget = authorizeToolCall(
            updateIssue(),
            { issueNumber: 2, state: "open" },
            scope,
        );
        expect(wrongTarget.allowed).toBe(false);
        expect(
            wrongTarget.allowed === false && wrongTarget.reason,
        ).toContain("#1");
    });

    it("requires state 'open' for a reopen scope", () => {
        const scope = deriveTaskScope("Reopen issue #1.");
        const missingState = authorizeToolCall(
            updateIssue(),
            { issueNumber: 1 },
            scope,
        );
        expect(missingState.allowed).toBe(false);
        const wrongState = authorizeToolCall(
            updateIssue(),
            { issueNumber: 1, state: "closed" },
            scope,
        );
        expect(wrongState.allowed).toBe(false);
    });

    it("allows untagged tools under any scope", () => {
        const scope = deriveTaskScope("Summarize the README.");
        const untagged: AgentTool = {
            name: "ad_hoc",
            description: "untagged",
            parameters: { type: "object", properties: {}, required: [] },
            execute: vi.fn(),
        };
        expect(authorizeToolCall(untagged, {}, scope).allowed).toBe(true);
    });
});

describe("fullTaskScope", () => {
    it("authorizes every registered mutation", () => {
        const scope = fullTaskScope();
        expect(authorizeToolCall(createIssue(), { title: "x" }, scope).allowed).toBe(
            true,
        );
        expect(authorizeToolCall(closeIssue(), { issueNumber: 1 }, scope).allowed).toBe(
            true,
        );
        expect(
            authorizeToolCall(createPr(), { title: "x", head: "b" }, scope)
                .allowed,
        ).toBe(true);
    });
});
