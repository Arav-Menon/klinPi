import { readFile, listDir } from "@klinpi/compute";
import type { AgentTool } from "../../types.js";

export const read_file: AgentTool = {
    name: "read_file",
    requiresSandbox: true,
    description:
        "Read the contents of a file from the agent's sandbox filesystem. Repository files live under /workspace. When the file is not at the repository root, locate it first with list_files and then read its exact path (e.g. main.py may be /workspace/basic-crud/main.py). Read-only: never use this as a prelude to modifying the repository unless the user asked for a change.",

    parameters: {
        type: "object",
        properties: {
            path: {
                type: "string",
                description:
                    "Absolute path to the file to read. Repository files live under /workspace (e.g. /workspace/main.py)",
            },
        },
        required: ["path"],
    },

    async execute(args, sandboxId) {
        const { path } = args as { path: string };
        if (!sandboxId) {
            return "Error: No sandbox available. The agent has not initialized a sandbox yet.";
        }
        try {
            return await readFile(sandboxId, path);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const base = `Error reading file '${path}': ${message}`;
            const dir = path.slice(0, path.lastIndexOf("/")) || "/";
            try {
                const listing = await listDir(sandboxId, dir || "/");
                return `${base}\nHint: repository root is /workspace — repository files live under /workspace. Contents of ${dir}:\n${listing}`;
            } catch {
                return `${base}\nHint: repository root is /workspace — repository files live under /workspace.`;
            }
        }
    },
};
