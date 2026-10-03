import { readFile, listDir } from "@klinpi/compute";
import type { AgentTool } from "../types.js";

export const read_file: AgentTool = {
    name: "read_file",
    requiresSandbox: true,
    description:
        "Read the contents of a file from the agent's sandbox filesystem. Repository files live under /workspace — if the user references a repository file as main.py or /README.md, read /workspace/main.py or /workspace/README.md",

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
