import type { AgentTool, ToolContext } from "../types.js";
import { createReadFileTool } from "./file_tools/read_file.js";
import { createEditFileTool } from "./file_tools/edit_file.js";
import { createListFilesTool } from "./file_tools/list_files.js";
import { clone_repo } from "./github_tools/clone_repo.js";
import { createCreateIssueTool } from "./github_tools/create_issue.js";
import { createListIssuesTool } from "./github_tools/list_issues.js";
import { createGetIssueTool } from "./github_tools/get_issue.js";
import { createUpdateIssueTool } from "./github_tools/update_issue.js";
import { createCloseIssueTool } from "./github_tools/close_issue.js";
import { createCreatePullRequestTool } from "./github_tools/create_pull_request.js";
import { createSaveMemoryTool } from "./save_memory.js";
import { run_command } from "./run_command.js";
import { git_branch } from "./git_tools/git_branch.js";
import { git_status } from "./git_tools/git_status.js";
import { git_diff } from "./git_tools/git_diff.js";
import { git_stage } from "./git_tools/git_stage.js";
import { createGitCommitTool } from "./git_tools/git_commit.js";
import { createGitPushTool } from "./git_tools/git_push.js";

export function getTools(context: ToolContext): AgentTool[] {
    return [
        createReadFileTool(context),
        createEditFileTool(context),
        clone_repo,
        createListFilesTool(context),
        git_branch,
        git_status,
        git_diff,
        git_stage,
        createGitCommitTool(context),
        createGitPushTool(context),
        run_command,
        createSaveMemoryTool(context),
        createCreateIssueTool(context),
        createListIssuesTool(context),
        createGetIssueTool(context),
        createUpdateIssueTool(context),
        createCloseIssueTool(context),
        createCreatePullRequestTool(context),
    ];
}
