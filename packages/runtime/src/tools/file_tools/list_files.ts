import { listDir } from "@klinpi/compute";
import type { AgentTool, ToolContext } from "../../types.js";

export function createListFilesTool(context: ToolContext): AgentTool {
    const { workflow } = context;

    return {
        name: "list_files",
        requiresSandbox: true,
        description:
            "List files and directories inside the agent's sandbox filesystem. Repository files live under /workspace (this is the default path). This is the discovery step: list the repository before modifying anything — a successful listing marks the repository as inspected, which edit_file requires before it will change files.",

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
                workflow.inspected = true;
                return `Contents of ${path}:\n${listing}`;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                if (path !== "/workspace") {
                    try {
                        const fallback = await listDir(sandboxId, "/workspace");
                        workflow.inspected = true;
                        return `Error listing '${path}': ${message}\nRepository root is /workspace. Contents of /workspace:\n${fallback}`;
                    } catch {
                        // Fall through to the static hint below
                    }
                }
                return `Error listing '${path}': ${message}\nRepository root is /workspace.`;
            }
        },
    };
}
