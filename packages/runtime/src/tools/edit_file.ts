import { writeFile } from "@klinpi/compute";
import type { AgentTool } from "../types.js";

export const edit_file: AgentTool = {
    name: "edit_file",
    description: "Write content to a file in the agent's sandbox filesystem",

    parameters: {
        type: "object",
        properties: {
            sandboxId: {
                type: "string",
                description: "The E2B sandbox ID",
            },
            path: {
                type: "string",
                description: "Absolute path to the file to write",
            },
            content: {
                type: "string",
                description: "The content to write to the file",
            },
        },
        required: ["sandboxId", "path", "content"],
    },

    async execute(args, _context) {
        const { sandboxId, path, content } = args as { sandboxId: string; path: string; content: string };
        try {
            await writeFile(sandboxId, path, content);
            return `Successfully wrote file '${path}'`;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return `Error writing file '${path}': ${message}`;
        }
    },
};