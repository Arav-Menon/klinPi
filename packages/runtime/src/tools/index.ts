import type { AgentTool } from "../types.js";
import { read_file } from "./read_file.js";
import { edit_file } from "./edit_file.js";
import { clone_repo } from "./clone_repo.js";

export function getTools(): AgentTool[] {
    return [read_file, edit_file, clone_repo];
}
