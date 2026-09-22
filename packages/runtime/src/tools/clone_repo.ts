import type { AgentTool } from "../types.js";
import { sandboxManger } from "@klinpi/compute";

export const clone_repo: AgentTool = {
    name: "clone_repo",
    description: "Clone a Git repository into the sandbox filesystem",

    parameters: {
        type: "object",
        properties: {
            url: {
                type: "string",
                description: "The Git clone URL (e.g., https://github.com/owner/repo.git)",
            },
            path: {
                type: "string",
                description: "Destination path inside the sandbox (default: /workspace)",
            },
            branch: {
                type: "string",
                description: "Branch to checkout (default: main)",
            },
        },
        required: ["url"],
    },

    async execute(args, sandboxId) {
        const { url, path = "/workspace", branch = "main" } = args as {
            url: string;
            path?: string;
            branch?: string;
        };

        if (!sandboxId) {
            return "Error: No sandbox available. The agent has not initialized a sandbox yet.";
        }

        try {
            const sandbox = await sandboxManger.connectSbx(sandboxId);
            const result = await sandbox.commands.run(
                `git clone --branch ${branch} ${url} ${path}`,
            );

            if (result.exitCode !== 0) {
                return `Error cloning repository: ${result.stderr}`;
            }

            return `Repository cloned successfully to '${path}' (branch: ${branch}). Output: ${result.stdout}`;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return `Error cloning repository '${url}': ${message}`;
        }
    },
};
