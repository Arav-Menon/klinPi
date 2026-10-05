import type { AgentTool } from "../types.js";
import {
    OUTPUT_LIMIT,
    WORKSPACE_PATH,
    runShell,
    scrubSecretPatterns,
    truncateOutput,
} from "./git_tools/git_helpers.js";

export const run_command: AgentTool = {
    name: "run_command",
    requiresSandbox: true,
    description:
        "Run a shell command inside the sandbox (default working directory /workspace). Use this for validation — tests, type checking, linting, formatting, builds. For reading file contents prefer read_file and for listing directories prefer list_files instead of cat/ls. For Git operations prefer the dedicated git_branch, git_status, git_diff, git_stage, git_commit and git_push tools. Output is truncated to a safe length.",

    parameters: {
        type: "object",
        properties: {
            command: {
                type: "string",
                description:
                    "The shell command to execute, e.g. 'npm test' or 'npx tsc --noEmit'",
            },
            cwd: {
                type: "string",
                description: `Working directory (default: ${WORKSPACE_PATH}); relative paths are resolved against ${WORKSPACE_PATH}`,
            },
        },
        required: ["command"],
    },

    async execute(args, sandboxId) {
        const { command, cwd } = args as { command?: unknown; cwd?: unknown };

        if (typeof command !== "string" || !command.trim()) {
            return "Error: 'command' must be a non-empty string.";
        }
        if (cwd !== undefined && typeof cwd !== "string") {
            return "Error: 'cwd' must be a string.";
        }

        if (!sandboxId) {
            return "Error: No sandbox available. The agent has not initialized a sandbox yet.";
        }

        const workingDirectory =
            typeof cwd === "string" && cwd.trim()
                ? cwd.trim().startsWith("/")
                    ? cwd.trim()
                    : `${WORKSPACE_PATH}/${cwd.trim().replace(/^\.\//, "")}`
                : WORKSPACE_PATH;

        try {
            const result = await runShell(sandboxId, command, workingDirectory);
            const stdout = scrubSecretPatterns(result.stdout);
            const stderr = scrubSecretPatterns(result.stderr);

            const sections = [`Exit code: ${result.exitCode}`];
            if (stdout.trim()) {
                sections.push(`stdout:\n${truncateOutput(stdout.trim(), OUTPUT_LIMIT)}`);
            }
            if (stderr.trim()) {
                sections.push(`stderr:\n${truncateOutput(stderr.trim(), OUTPUT_LIMIT)}`);
            }
            if (!stdout.trim() && !stderr.trim()) {
                sections.push("(no output)");
            }
            return sections.join("\n");
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return `Error running command: ${scrubSecretPatterns(message)}`;
        }
    },
};
