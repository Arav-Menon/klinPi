import { readFile } from "@klinpi/compute";
import type { AgentTool } from "../types.js";

export const read_file: AgentTool = {
    name: "read_file",
    description: "Read the contents of a file from the agent's sandbox filesystem",

    parameters: {
        type: "object",
        properties: {
            sandboxId: {
                type: "string",
                description: "The E2B sandbox ID",
            },
            path: {
                type: "string",
                description: "Absolute path to the file to read",
            },
        },
        required: ["sandboxId", "path"],
    },

    async execute(args, _context) {
        const { sandboxId, path } = args as { sandboxId: string; path: string };
        try {
            return await readFile(sandboxId, path);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return `Error reading file '${path}': ${message}`;
        }
    },
};
