import type { AgentTool } from "../../types.js";
import { ensureGitRepository, runShell, truncateOutput } from "./git_helpers.js";

export const git_status: AgentTool = {
    name: "git_status",
    requiresSandbox: true,
    description:
        "Show the working tree status of the sandbox repository (/workspace): current branch, staged, unstaged and untracked changes. Use before staging or committing, after editing files, and when reviewing what would be included in a commit.",

    parameters: {
        type: "object",
        properties: {},
        required: [],
    },

    async execute(_args, sandboxId) {
        if (!sandboxId) {
            return "Error: No sandbox available. The agent has not initialized a sandbox yet.";
        }

        try {
            const repoError = await ensureGitRepository(sandboxId);
            if (repoError) {
                return repoError;
            }

            const result = await runShell(
                sandboxId,
                "git status --porcelain=v1 --branch",
            );
            if (result.exitCode !== 0) {
                return `Error running git status: ${result.stderr.trim() || result.stdout.trim()}`;
            }

            const output = result.stdout.trim();
            return truncateOutput(
                `Git status (branch, staged, unstaged, untracked):\n${output || "(working tree clean)"}`,
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return `Error running git status: ${message}`;
        }
    },
};
