import type { AgentTool } from "../../types.js";
import {
    describeInvalidBranchName,
    ensureGitRepository,
    runShell,
    shellQuote,
} from "./git_helpers.js";

export const git_branch: AgentTool = {
    name: "git_branch",
    requiresSandbox: true,
    description:
        "Create and switch to a new Git branch in the sandbox repository (/workspace), or switch to an existing branch. For Pull Request work this is the FIRST step: create a dedicated feature/fix branch before implementing changes instead of working on the default branch. This tool only performs checkout — it does not stage, commit, or push.",

    parameters: {
        type: "object",
        properties: {
            branch: {
                type: "string",
                description:
                    "Branch name to create or switch to, e.g. 'feat/add-get-documentation' or 'fix/session-auth-validation'",
            },
            create: {
                type: "boolean",
                description:
                    "true (default) creates the branch with 'git checkout -b'; false switches to an existing branch",
            },
            base: {
                type: "string",
                description:
                    "Optional branch name or commit to start from (defaults to the current HEAD)",
            },
        },
        required: ["branch"],
    },

    async execute(args, sandboxId) {
        const { branch, create = true, base } = args as {
            branch?: string;
            create?: boolean;
            base?: string;
        };

        if (typeof branch !== "string") {
            return "Error: 'branch' must be a non-empty string.";
        }
        const invalid = describeInvalidBranchName(branch);
        if (invalid) {
            return `Error: ${invalid}.`;
        }
        if (base !== undefined) {
            if (typeof base !== "string" || !base.trim()) {
                return "Error: 'base' must be a non-empty string when provided.";
            }
            const invalidBase = describeInvalidBranchName(base);
            if (invalidBase) {
                return `Error: invalid 'base': ${invalidBase}.`;
            }
        }
        if (typeof create !== "boolean") {
            return "Error: 'create' must be a boolean.";
        }

        if (!sandboxId) {
            return "Error: No sandbox available. The agent has not initialized a sandbox yet.";
        }

        try {
            const repoError = await ensureGitRepository(sandboxId);
            if (repoError) {
                return repoError;
            }

            const checkoutCommand = create
                ? `git checkout -b ${shellQuote(branch)}${base !== undefined ? ` ${shellQuote(base)}` : ""}`
                : `git checkout ${shellQuote(branch)}`;

            const checkout = await runShell(sandboxId, checkoutCommand);
            if (checkout.exitCode !== 0) {
                const stderr = checkout.stderr.trim() || checkout.stdout.trim();
                if (create && stderr.includes("already exists")) {
                    return `Error: branch '${branch}' already exists. Switch to it with create=false.`;
                }
                return `Error ${create ? "creating" : "switching to"} branch '${branch}': ${stderr}`;
            }

            const current = await runShell(
                sandboxId,
                "git rev-parse --abbrev-ref HEAD",
            );
            const currentBranch = current.stdout.trim() || branch;
            return `${create ? "Created and switched to" : "Switched to"} branch '${currentBranch}'. Next: inspect the repository, implement the change, review with git_diff, validate with run_command, then git_stage → git_commit → git_push → create_pull_request — one step at a time, checking each result.`;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return `Error running git branch: ${message}`;
        }
    },
};
