import type { AgentTool, ToolContext } from "../types.js";
import { read_file } from "./file_tools/read_file.js";
import { edit_file } from "./file_tools/edit_file.js";
import { list_files } from "./file_tools/list_files.js";
import { clone_repo } from "./github_tools/clone_repo.js";
import { createCreateIssueTool } from "./github_tools/create_issue.js";
import { createCreatePullRequestTool } from "./github_tools/create_pull_request.js";
import { createSaveMemoryTool } from "./save_memory.js";
import { run_command } from "./run_command.js";
import { git_branch } from "./git_tools/git_branch.js";
import { git_status } from "./git_tools/git_status.js";
import { git_diff } from "./git_tools/git_diff.js";
import { git_stage } from "./git_tools/git_stage.js";
import { git_commit } from "./git_tools/git_commit.js";
import { createGitPushTool } from "./git_tools/git_push.js";

export function getTools(context: ToolContext): AgentTool[] {
    return [
        read_file,
        edit_file,
        clone_repo,
        list_files,
        git_branch,
        git_status,
        git_diff,
        git_stage,
        git_commit,
        createGitPushTool(context),
        run_command,
        createSaveMemoryTool(context),
        createCreateIssueTool(context),
        createCreatePullRequestTool(context),
    ];
}
