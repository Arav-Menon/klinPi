import { listDir, writeFile } from "@klinpi/compute";
import type { AgentTool, ToolContext } from "../../types.js";
import { isRepositoryPath } from "../../lib/workflowState.js";

/**
 * Whether `path` already exists in the sandbox. Uses the parent directory
 * listing so no file content is read. A missing/unreadable parent means the
 * file does not exist yet (new file in a new directory).
 */
async function fileExists(sandboxId: string, path: string): Promise<boolean> {
    const normalized = path.endsWith("/") ? path.slice(0, -1) : path;
    const slash = normalized.lastIndexOf("/");
    const base = slash >= 0 ? normalized.slice(slash + 1) : normalized;
    const parent = slash > 0 ? normalized.slice(0, slash) : "/";
    if (!base) {
        return false;
    }
    try {
        const listing = await listDir(sandboxId, parent);
        if (listing === "(empty)") {
            return false;
        }
        return listing.split("\n").some((line) => {
            const name = line.endsWith("/") ? line.slice(0, -1) : line.split(" (")[0];
            return name === base;
        });
    } catch {
        return false;
    }
}

export function createEditFileTool(context: ToolContext): AgentTool {
    const { workflow } = context;

    return {
        name: "edit_file",
        requiresSandbox: true,
        description:
            "Write content to a file in the agent's sandbox filesystem. Repository files live under /workspace and the path must be absolute (e.g. /workspace/Dockerfile). Preconditions enforced by this tool: the repository must already be inspected this run (list_files or a successful read_file), and an existing file under /workspace must have been read with read_file before it is overwritten — new files only need the prior inspection. Read the file, understand it, then write the complete new content. Do not use for read-only requests.",

        parameters: {
            type: "object",
            properties: {
                path: {
                    type: "string",
                    description:
                        "Absolute path to the file to write. Repository files live under /workspace (e.g. /workspace/Dockerfile)",
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
            if (typeof path !== "string" || !path.trim()) {
                return "Error: 'path' must be a non-empty string.";
            }
            if (typeof content !== "string") {
                return "Error: 'content' must be a string.";
            }
            if (!path.startsWith("/")) {
                return `Error: 'path' must be an absolute path (e.g. /workspace/Dockerfile) — repository files live under /workspace.`;
            }
            if (!workflow.inspected) {
                return (
                    "Error: the repository has not been inspected in this run yet. " +
                    "Call list_files (start at /workspace) and read the relevant files with read_file to base the change on the actual code, " +
                    "then call edit_file again with the evidence you found."
                );
            }
            if (isRepositoryPath(path) && !workflow.readPaths.has(path)) {
                const exists = await fileExists(sandboxId, path);
                if (exists) {
                    return (
                        `Error: '${path}' already exists but has not been read in this run. ` +
                        "Call read_file on it first, understand its current contents, then call edit_file with the complete new content."
                    );
                }
            }

            try {
                await writeFile(sandboxId, path, content);
                workflow.writeCount += 1;
                workflow.writtenPaths.add(path);
                return `Successfully wrote file '${path}'`;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return `Error writing file '${path}': ${message}`;
            }
        },
    };
}
