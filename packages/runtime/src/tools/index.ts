import type { AgentTool, ToolContext } from "../types.js";
import { read_file } from "./read_file.js";
import { edit_file } from "./edit_file.js";
import { clone_repo } from "./clone_repo.js";
import { list_files } from "./list_files.js";
import { createSaveMemoryTool } from "./save_memory.js";

export function getTools(context: ToolContext): AgentTool[] {
    return [read_file, edit_file, clone_repo, list_files, createSaveMemoryTool(context)];
}
