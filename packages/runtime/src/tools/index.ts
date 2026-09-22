import type { AgentTool } from "../types.js";
import { read_file } from "./read_file.js";
import { edit_file } from "./edit_file.js";

export function getTools(): AgentTool[] {
    return [read_file, edit_file];
}
