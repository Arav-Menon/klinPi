import { readFile, listDir } from "@klinpi/compute";
import type { AgentTool, ToolContext } from "../../types.js";

export function createReadFileTool(context: ToolContext): AgentTool {
    const { workflow } = context;

    return {
        name: "read_file",
        requiresSandbox: true,
        capabilities: ["fs.read"],
        description:
            "Read the contents of a file from the agent's sandbox filesystem. Repository files live under /workspace. When the file is not at the repository root, locate it first with list_files and then read its exact path (e.g. main.py may be /workspace/basic-crud/main.py). Required before overwriting an existing repository file: edit_file refuses to change a file that has not been read with this tool first. Only for files the user asked to change or inspect — never as busywork.",

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
            // Repository files live under /workspace, but E2B resolves a
            // relative path against the sandbox default cwd (/home/user),
            // which never contains them. Resolve relative paths against the
            // repository root so a natural call like path:"readme.md"
            // reads /workspace/readme.md. Absolute and ~ paths pass through
            // unchanged; writes (edit_file) stay strict and require an
            // explicit absolute path.
            const resolved =
                path.startsWith("/") || path.startsWith("~")
                    ? path
                    : `/workspace/${path.replace(/^\.\//, "")}`;
            try {
                const content = await readFile(sandboxId, resolved);
                workflow.readPaths.add(resolved);
                workflow.inspected = true;
                return content;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                const base = `Error reading file '${resolved}': ${message}`;
                const dir = resolved.slice(0, resolved.lastIndexOf("/")) || "/";
                try {
                    const listing = await listDir(sandboxId, dir || "/");
                    return `${base}\nHint: repository root is /workspace — repository files live under /workspace. Contents of ${dir}:\n${listing}`;
                } catch {
                    return `${base}\nHint: repository root is /workspace — repository files live under /workspace.`;
                }
            }
        },
    };
}
