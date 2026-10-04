import type { AgentTool } from "../../types.js";
import { ensureGitRepository, runShell, truncateOutput } from "./git_helpers.js";

export const git_diff: AgentTool = {
    name: "git_diff",
    requiresSandbox: true,
    description:
        "Show Git diffs of the sandbox repository (/workspace). Default: all staged and unstaged changes against the last commit. Set staged=true to review only what is staged for the next commit. Review the diff after implementing changes and before committing.",

    parameters: {
        type: "object",
        properties: {
            staged: {
                type: "boolean",
                description:
                    "true to show only staged changes (git diff --cached); default false shows all changes against HEAD",
            },
        },
        required: [],
    },

    async execute(args, sandboxId) {
        const { staged = false } = args as { staged?: boolean };
        if (staged !== undefined && typeof staged !== "boolean") {
            return "Error: 'staged' must be a boolean.";
        }

        if (!sandboxId) {
            return "Error: No sandbox available. The agent has not initialized a sandbox yet.";
        }

        try {
            const repoError = await ensureGitRepository(sandboxId);
            if (repoError) {
                return repoError;
            }

            const command = staged ? "git diff --cached" : "git diff HEAD";
            const result = await runShell(sandboxId, command);
            if (result.exitCode !== 0) {
                return `Error running ${command}: ${result.stderr.trim() || result.stdout.trim()}`;
            }

            const diff = result.stdout;
            if (!diff.trim()) {
                return staged
                    ? "No staged changes."
                    : "No changes (working tree matches the last commit).";
            }
            return truncateOutput(
                `${staged ? "Staged diff:" : "Diff against HEAD:"}\n${diff}`,
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return `Error running git diff: ${message}`;
        }
    },
};
