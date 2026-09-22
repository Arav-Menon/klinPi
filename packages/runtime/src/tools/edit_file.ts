import { writeFile } from "@klinpi/compute";
import type { AgentTool } from "../types.js";

export const edit_file: AgentTool = {
    name: "edit_file",
    description: "Write content to a file in the agent's sandbox filesystem",

    parameters: {
        type: "object",
        properties: {
            path: {
                type: "string",
                description: "Absolute path to the file to write",
            },
            content: {
                type: "string",
                description: "The content to write to the file",
            },
        },
        required: ["path", "content"],
    },

    async execute(args, sandboxId) {
        const { path, content } = args as { path: string; content: string };
        if (!sandboxId) {
            return "Error: No sandbox available. The agent has not initialized a sandbox yet.";
        }
        try {
            await writeFile(sandboxId, path, content);
            return `Successfully wrote file '${path}'`;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return `Error writing file '${path}': ${message}`;
        }
    },
};
