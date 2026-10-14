/**
 * Task scope: what the current user request authorizes this run to do.
 *
 * `deriveTaskScope` proposes a scope from the prompt using conservative
 * signals (the existing workflow-state intent analysis plus a small
 * issue-operation parser). Signals only ever GRANT — every external
 * mutation budget starts at zero and is raised only on positive evidence.
 * The authoritative control is `authorizeToolCall`, which the loop invokes
 * at the execution boundary for every call: a scope denial never reaches a
 * tool implementation, never consumes budget, and never invents arguments.
 */
import type { AgentTool } from "../types.js";
import { isTaskPrompt, taskIntents } from "./workflowState.js";

export type ToolCapability =
    | "fs.read"
    | "fs.write"
    | "git.local"
    | "git.push"
    | "shell"
    | "memory"
    | "github.read"
    | "github.create_issue"
    | "github.update_issue"
    | "github.close_issue"
    | "github.create_pr";

/** Counted operations: remaining authorized executions. */
export interface MutationBudget {
    remaining: number;
}

export interface TaskScope {
    /** Short human-readable description of the authorized objective. */
    objective: string;
    capabilities: ReadonlySet<ToolCapability>;
    budgets: {
        createIssue: MutationBudget;
        updateIssue: MutationBudget;
        closeIssue: MutationBudget;
        createPullRequest: MutationBudget;
        gitPush: MutationBudget;
    };
    /**
     * When set, update_issue/close_issue calls must target this issue
     * number (and update_issue must set `issueState` when provided).
     */
    constraints: {
        issueNumber?: number;
        issueState?: "open" | "closed";
    };
    /** One-line summary rendered into the model-facing context. */
    summary: string;
}

const BASELINE_CAPABILITIES: readonly ToolCapability[] = [
    "fs.read",
    "github.read",
    "memory",
];

const MUTATION_BUDGET_KEYS = [
    "createIssue",
    "updateIssue",
    "closeIssue",
    "createPullRequest",
    "gitPush",
] as const;

type MutationBudgetKey = (typeof MUTATION_BUDGET_KEYS)[number];

const CAPABILITY_BUDGET: Partial<Record<ToolCapability, MutationBudgetKey>> = {
    "github.create_issue": "createIssue",
    "github.update_issue": "updateIssue",
    "github.close_issue": "closeIssue",
    "github.create_pr": "createPullRequest",
    "git.push": "gitPush",
};

function emptyBudgets(): TaskScope["budgets"] {
    return {
        createIssue: { remaining: 0 },
        updateIssue: { remaining: 0 },
        closeIssue: { remaining: 0 },
        createPullRequest: { remaining: 0 },
        gitPush: { remaining: 0 },
    };
}

/** Permissive scope used when no scope was derived (back-compat). */
export function fullTaskScope(): TaskScope {
    return {
        objective: "full (no scope restrictions)",
        capabilities: new Set<ToolCapability>([
            ...BASELINE_CAPABILITIES,
            "fs.write",
            "git.local",
            "git.push",
            "shell",
            "github.create_issue",
            "github.update_issue",
            "github.close_issue",
            "github.create_pr",
        ]),
        budgets: {
            createIssue: { remaining: Number.MAX_SAFE_INTEGER },
            updateIssue: { remaining: Number.MAX_SAFE_INTEGER },
            closeIssue: { remaining: Number.MAX_SAFE_INTEGER },
            createPullRequest: { remaining: Number.MAX_SAFE_INTEGER },
            gitPush: { remaining: Number.MAX_SAFE_INTEGER },
        },
        constraints: {},
        summary: "Full tool catalog available (no task scope was established).",
    };
}

const CARDINALITY_WORDS: Record<string, number> = {
    a: 1,
    an: 1,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    "1": 1,
    "2": 2,
    "3": 3,
    "4": 4,
    "5": 5,
};

const ISSUE_NUMBER_RE = /#(\d+)\b/;

function extractIssueNumber(text: string): number | undefined {
    const match = ISSUE_NUMBER_RE.exec(text);
    return match ? Number(match[1]) : undefined;
}

/**
 * Reopen: the verb "reopen"/"re-open", or "open" combined with an existing
 * issue number ("open issue #1"). A number-free "open an issue about X"
 * is creation, not reopening, and is handled by matchCreateIssue.
 */
function matchReopen(text: string): { issueNumber?: number } | null {
    const verb = /\b(?:reopen|re-open)\b/i.test(text);
    const openNumbered =
        /\bopen\b/i.test(text) &&
        /\bissues?\s*#?\d+\b/i.test(text) &&
        extractIssueNumber(text) !== undefined;
    if (!verb && !openNumbered) return null;
    const issueNumber = extractIssueNumber(text);
    return issueNumber !== undefined ? { issueNumber } : {};
}

function matchClose(text: string): { issueNumber?: number } | null {
    if (
        !/\b(?:close|delete|resolve)\s+(?:an?\s+|the\s+|this\s+)?(?:github\s+)?issues?\b/i.test(
            text,
        )
    ) {
        return null;
    }
    const issueNumber = extractIssueNumber(text);
    return issueNumber !== undefined ? { issueNumber } : {};
}

function matchCreateIssue(text: string): { count: number } | null {
    // "issue(s)" plus common synonyms users actually write: "bug report",
    // "report" as a noun after the creation verb.
    const match =
        /\b(?:create|file|add|start|log|raise|submit|report|open)\s+(?:(?:an?|one|two|three|four|five|[1-5])\s+)?(?:new\s+)?(?:github\s+)?(?:issues?|bug\s+reports?|reports?)\b/i.exec(
            text,
        );
    if (!match) return null;
    // "open issue #1" with a real number is a reopen, not a creation.
    if (/\bopen\b/i.test(match[0]) && extractIssueNumber(text) !== undefined) {
        return null;
    }
    const cardinal =
        /\b(a|an|one|two|three|four|five|[1-5])\s+(?:github\s+)?(?:issues?|bug\s+reports?|reports?)\b/i.exec(
            text,
        );
    const word = cardinal?.[1]?.toLowerCase();
    const count = word !== undefined ? (CARDINALITY_WORDS[word] ?? 1) : 1;
    return { count };
}

/**
 * Derive the authorized scope for a prompt. Conservative by design:
 * - Baseline grants inspection only (fs.read, github.read, memory).
 * - Local workspace work (fs.write, git.local, shell) requires task
 *   wording, an explicit write/commit/push/PR intent, or a URL (clone).
 * - Every external mutation budget starts at 0 and is raised only on
 *   explicit positive evidence; ambiguous requests get no mutations.
 */
export function deriveTaskScope(prompt: string): TaskScope {
    const text = prompt;
    const capabilities = new Set<ToolCapability>(BASELINE_CAPABILITIES);
    const budgets = emptyBudgets();
    const constraints: TaskScope["constraints"] = {};
    const parts: string[] = [];

    const { wantsWrite, wantsCommit, wantsPush, wantsPr } = taskIntents(text);
    const task = isTaskPrompt(text);
    const hasUrl = /\bhttps?:\/\/\S+/.test(text);

    const reopen = matchReopen(text);
    const close = matchClose(text);
    const create = matchCreateIssue(text);
    const issueOpMatched = reopen !== null || close !== null || create !== null;

    if (wantsWrite || wantsCommit || wantsPush || wantsPr || hasUrl || (task && !issueOpMatched)) {
        capabilities.add("fs.write");
        capabilities.add("git.local");
        capabilities.add("shell");
    }
    if (wantsPush || wantsPr) {
        // A pull request cannot exist without a pushed branch — authorizing
        // a PR must implicitly authorize the one push that delivers it.
        capabilities.add("git.push");
        if (budgets.gitPush.remaining < 1) budgets.gitPush.remaining = 1;
        if (wantsPush) parts.push("push one branch");
    }
    if (wantsPr) {
        capabilities.add("github.create_pr");
        budgets.createPullRequest.remaining = 1;
        parts.push("open one pull request");
    }

    // Track issue numbers so a single-number request can be constrained.
    const numbers = new Set<number>();
    if (reopen !== null) {
        capabilities.add("github.update_issue");
        budgets.updateIssue.remaining = 1;
        if (reopen.issueNumber !== undefined) numbers.add(reopen.issueNumber);
        parts.push(
            reopen.issueNumber !== undefined
                ? `reopen issue #${reopen.issueNumber}`
                : "reopen an issue",
        );
    }
    if (close !== null) {
        capabilities.add("github.close_issue");
        budgets.closeIssue.remaining = 1;
        if (close.issueNumber !== undefined) numbers.add(close.issueNumber);
        parts.push(
            close.issueNumber !== undefined
                ? `close issue #${close.issueNumber}`
                : "close one issue",
        );
    }
    if (create !== null) {
        capabilities.add("github.create_issue");
        budgets.createIssue.remaining = create.count;
        parts.push(
            create.count === 1 ? "create one issue" : `create ${create.count} issues`,
        );
    }
    // Constrain targets only when every matched operation agrees on the
    // number (a multi-issue request is bounded by budgets alone).
    if (numbers.size === 1) {
        const pinned = [...numbers][0];
        if (pinned !== undefined) {
            constraints.issueNumber = pinned;
            if (reopen !== null && reopen.issueNumber !== undefined) {
                constraints.issueState = "open";
            }
        }
    }

    const objective =
        parts.length > 0
            ? parts.join("; ")
            : task
                ? "local repository work (no external mutations authorized)"
                : "read-only inspection and answer";
    const workspaceGrant =
        capabilities.has("fs.write") ? "" : " No local file modifications are authorized.";
    const summary =
        `Authorized for this run: ${objective}. ` +
        `Available operations: read repository files, inspect GitHub issues${workspaceGrant} ` +
        "Operations outside this scope are denied at execution time.";

    return { objective, capabilities, budgets, constraints, summary };
}

/**
 * The tools the model may be offered for this scope. Tools without
 * capability tags are always included (ad-hoc/test tools); tagged tools
 * require every capability they declare to be in scope AND any budget
 * behind that capability to still have remaining executions — a consumed
 * budget (e.g. the one authorized issue was created) removes the tool
 * from the next model request.
 */
export function selectToolsForScope(
    registry: AgentTool[],
    scope: TaskScope,
): AgentTool[] {
    return registry.filter((tool) => {
        if (tool.capabilities === undefined) return true;
        return tool.capabilities.every((capability) => {
            if (!scope.capabilities.has(capability)) return false;
            const budgetKey = CAPABILITY_BUDGET[capability];
            if (budgetKey !== undefined && scope.budgets[budgetKey].remaining <= 0) {
                return false;
            }
            return true;
        });
    });
}

export type AuthorizationDecision =
    | { allowed: true }
    | { allowed: false; reason: string };

function deny(reason: string): AuthorizationDecision {
    return { allowed: false, reason };
}

/**
 * Authorize one tool call against the scope. Pure and side-effect free:
 * budgets are consumed only via `recordMutationOutcome` after a call
 * actually executes successfully. Validates, in order: capability
 * membership, remaining budget, and issue target/state constraints.
 */
export function authorizeToolCall(
    tool: AgentTool,
    args: Record<string, unknown>,
    scope: TaskScope,
): AuthorizationDecision {
    const capabilities = tool.capabilities;
    if (capabilities === undefined || capabilities.length === 0) {
        return { allowed: true };
    }
    for (const capability of capabilities) {
        if (!scope.capabilities.has(capability)) {
            return deny(
                `${tool.name} performs '${capability}', which the user's request did not authorize`,
            );
        }
        const budgetKey = CAPABILITY_BUDGET[capability];
        if (budgetKey !== undefined && scope.budgets[budgetKey].remaining <= 0) {
            return deny(
                `the authorized budget for ${tool.name} is exhausted for this request`,
            );
        }
    }

    // Issue target constraints apply to update/close only when the scope
    // pinned a specific issue.
    const pinned = scope.constraints.issueNumber;
    if (pinned !== undefined) {
        if (
            capabilities.includes("github.update_issue") ||
            capabilities.includes("github.close_issue")
        ) {
            const target = args.issueNumber;
            if (typeof target !== "number" || !Number.isInteger(target)) {
                return deny(
                    `the request authorizes issue #${pinned} only — call with {"issueNumber":${pinned}}`,
                );
            }
            if (target !== pinned) {
                return deny(
                    `the request authorizes issue #${pinned} only, but this call targets issue #${target}`,
                );
            }
        }
        if (
            capabilities.includes("github.update_issue") &&
            scope.constraints.issueState !== undefined
        ) {
            if (args.state !== scope.constraints.issueState) {
                return deny(
                    `reopening requires {"issueNumber":${pinned},"state":"${scope.constraints.issueState}"} — update_issue must set state '${scope.constraints.issueState}'`,
                );
            }
        }
    }
    return { allowed: true };
}

/**
 * Consume budget after a tool call executed successfully. Failed or timed
 * out calls do not consume budget, so a corrected retry of the same
 * objective stays in scope. Called only by the loop at the execution
 * boundary.
 */
export function recordMutationOutcome(
    scope: TaskScope,
    tool: AgentTool,
    succeeded: boolean,
): void {
    if (!succeeded || tool.capabilities === undefined) return;
    for (const capability of tool.capabilities) {
        const budgetKey = CAPABILITY_BUDGET[capability];
        if (budgetKey === undefined) continue;
        const budget: MutationBudget = scope.budgets[budgetKey];
        if (budget.remaining > 0 && budget.remaining < Number.MAX_SAFE_INTEGER) {
            budget.remaining -= 1;
        }
    }
}
