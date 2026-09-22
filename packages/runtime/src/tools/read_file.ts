import { readFile } from "@klinpi/compute";
import type { AgentTool } from "../types.js";

export const read_file: AgentTool = {
    name: "read_file",
    description: "Read the contents of a file from the agent's sandbox filesystem",

    parameters: {
        type: "object",
        properties: {
            path: {
                type: "string",
                description: "Absolute path to the file to read",
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
            return `Error reading file '${path}': ${message}`;
        }
    },
};
