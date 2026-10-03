import { listDir } from "@klinpi/compute";
import type { AgentTool } from "../types.js";

export const list_files: AgentTool = {
    name: "list_files",
    requiresSandbox: true,
    description:
        "List files and directories inside the agent's sandbox filesystem. Repository files live under /workspace (this is the default path)",

    parameters: {
        type: "object",
        properties: {
            path: {
                type: "string",
                description:
                    "Directory path to list (default: /workspace). Repository files live under /workspace",
            },
        },
        required: [],
    },

    async execute(args, sandboxId) {
        const { path = "/workspace" } = args as { path?: string };
        if (!sandboxId) {
            return "Error: No sandbox available. The agent has not initialized a sandbox yet.";
        }
        try {
            const listing = await listDir(sandboxId, path);
            return `Contents of ${path}:\n${listing}`;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (path !== "/workspace") {
                try {
                    const fallback = await listDir(sandboxId, "/workspace");
                    return `Error listing '${path}': ${message}\nRepository root is /workspace. Contents of /workspace:\n${fallback}`;
                } catch {
                    // Fall through to the static hint below
                }
            }
            return `Error listing '${path}': ${message}\nRepository root is /workspace.`;
        }
    },
};
