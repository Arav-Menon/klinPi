import type { AgentTool } from "../../types.js";
import {
    ensureGitRepository,
    normalizeRepoPath,
    runShell,
    shellQuote,
    truncateOutput,
} from "./git_helpers.js";

export const git_stage: AgentTool = {
    name: "git_stage",
    requiresSandbox: true,
    description:
        "Stage specific file changes for the next commit (git add) in the sandbox repository (/workspace). Stage only the files intended for the commit — never stage unrelated or user changes. Use '.' to stage everything in the repository root when the working tree contains only your changes.",

    parameters: {
        type: "object",
        properties: {
            paths: {
                type: "array",
                items: { type: "string" },
                description:
                    "Repository-relative paths to stage, e.g. ['src/app.ts', 'README.md'] or ['.'] to stage all changes",
            },
        },
        required: ["paths"],
    },

    async execute(args, sandboxId) {
        const { paths } = args as { paths?: unknown };

        if (!Array.isArray(paths) || paths.length === 0) {
            return "Error: 'paths' must be a non-empty array of file paths.";
        }
        if (!paths.every((p) => typeof p === "string" && p.trim().length > 0)) {
            return "Error: every entry in 'paths' must be a non-empty string.";
        }

        if (!sandboxId) {
            return "Error: No sandbox available. The agent has not initialized a sandbox yet.";
        }

        try {
            const repoError = await ensureGitRepository(sandboxId);
            if (repoError) {
                return repoError;
            }

            const normalized = (paths as string[]).map((p) => normalizeRepoPath(p));
            const quoted = normalized.map((p) => shellQuote(p)).join(" ");
            const add = await runShell(sandboxId, `git add -- ${quoted}`);
            if (add.exitCode !== 0) {
                return `Error staging paths: ${add.stderr.trim() || add.stdout.trim()}`;
            }

            const staged = await runShell(
                sandboxId,
                "git diff --cached --stat",
            );
            const summary = staged.stdout.trim() || "(no staged changes detected)";
            return `Staged: ${normalized.join(", ")}\n${truncateOutput(summary)}`;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return `Error staging paths: ${message}`;
        }
    },
};
