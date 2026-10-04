import type { AgentTool } from "../../types.js";
import {
    ensureGitRepository,
    runShell,
    shellQuote,
    truncateOutput,
} from "./git_helpers.js";

const DEFAULT_AUTHOR_NAME = "Klinpi";
const DEFAULT_AUTHOR_EMAIL = "klinpi@users.noreply.github.com";

const IDENTITY_COMMAND =
    `git config user.name >/dev/null 2>&1 || git config user.name ${DEFAULT_AUTHOR_NAME} && ` +
    `git config user.email >/dev/null 2>&1 || git config user.email ${DEFAULT_AUTHOR_EMAIL}`;

export const git_commit: AgentTool = {
    name: "git_commit",
    requiresSandbox: true,
    description:
        "Create a Git commit from already-staged changes in the sandbox repository (/workspace). Stage the intended files with git_stage first — this tool refuses when nothing is staged. Write a meaningful conventional commit message (e.g. 'feat: add FastAPI GET method documentation'); never use placeholder messages like 'changes' or 'update'.",

    parameters: {
        type: "object",
        properties: {
            message: {
                type: "string",
                description:
                    "Commit message describing the actual change, e.g. 'feat: add FastAPI GET method documentation'",
            },
        },
        required: ["message"],
    },

    async execute(args, sandboxId) {
        const { message } = args as { message?: unknown };

        if (typeof message !== "string" || !message.trim()) {
            return "Error: 'message' must be a non-empty string.";
        }

        if (!sandboxId) {
            return "Error: No sandbox available. The agent has not initialized a sandbox yet.";
        }

        try {
            const repoError = await ensureGitRepository(sandboxId);
            if (repoError) {
                return repoError;
            }

            await runShell(sandboxId, IDENTITY_COMMAND);

            const stagedCheck = await runShell(
                sandboxId,
                "git diff --cached --quiet",
            );
            if (stagedCheck.exitCode === 0) {
                const status = await runShell(sandboxId, "git status --porcelain");
                const hasChanges = status.stdout.trim().length > 0;
                return hasChanges
                    ? "Error: changes exist but nothing is staged. Review them with git_status, stage the intended files with git_stage, then commit."
                    : "Error: nothing to commit — the working tree is clean. Implement the changes first.";
            }
            if (stagedCheck.exitCode !== 1) {
                return `Error checking staged changes: ${stagedCheck.stderr.trim() || stagedCheck.stdout.trim()}`;
            }

            const commit = await runShell(
                sandboxId,
                `git commit -m ${shellQuote(message.trim())}`,
            );
            if (commit.exitCode !== 0) {
                return `Error creating commit: ${commit.stderr.trim() || commit.stdout.trim()}`;
            }

            const head = await runShell(
                sandboxId,
                "git log -1 --format=%H%n%s",
            );
            const [hash, ...subject] = head.stdout.trim().split("\n");
            return truncateOutput(
                `Created commit ${hash ?? "(unknown)"}: ${subject.join(" ").trim() || message.trim()}\nPush the branch with git_push before creating a Pull Request.`,
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return `Error creating commit: ${message}`;
        }
    },
};
