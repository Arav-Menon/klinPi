import type { AgentTool, ToolContext } from "../../types.js";
import { resolveToolToken } from "./github_auth.js";
import { toGitHubToolError } from "./github_errors.js";
import { resolveIssueTarget } from "./github_repo.js";
import { getIssue, updateIssue } from "./github_api.js";
import { parseIssueNumber } from "./issue_validation.js";

interface CloseIssueArgs {
  owner?: unknown;
  repo?: unknown;
  issueNumber?: unknown;
}

export function createCloseIssueTool(context: ToolContext): AgentTool {
  return {
    name: "close_issue",
    description:
      "Close an existing GitHub issue by setting its state to 'closed'. GitHub does not support deleting issues through this API, so closing is the delete-equivalent — use this tool when the user asks to delete or close an issue, and say that the issue was closed rather than deleted. The issue number must refer to a real issue, not a pull request.",

    parameters: {
      type: "object",
      properties: {
        owner: {
          type: "string",
          description:
            "The repository owner (GitHub user or organization), e.g. 'octocat'. Optional when a repository is linked to the session — taken from the linked repository",
        },
        repo: {
          type: "string",
          description:
            "The repository name, e.g. 'hello-world'. Optional when a repository is linked to the session — taken from the linked repository",
        },
        issueNumber: {
          type: "number",
          description: "The issue number to close, e.g. 42",
        },
      },
      required: context.repositoryId
        ? ["issueNumber"]
        : ["owner", "repo", "issueNumber"],
    },

    async execute(args) {
      const closeArgs = args as CloseIssueArgs;

      const target = await resolveIssueTarget(
        context,
        "close_issue",
        closeArgs.owner,
        closeArgs.repo,
      );
      if (!target.ok) {
        return target.error;
      }
      const issueNumber = parseIssueNumber(closeArgs.issueNumber);
      if (!issueNumber.ok) {
        return issueNumber.error;
      }
      const { owner, repo: repoName } = target;
      const number = issueNumber.value;

      const lookup = await resolveToolToken(context);
      if (lookup.error) {
        return lookup.error;
      }
      const token = lookup.token!;

      try {
        // GitHub numbers issues and pull requests in the same sequence —
        // verify the target is a real issue before mutating anything.
        const existing = await getIssue(token, {
          owner,
          repo: repoName,
          issueNumber: number,
        });
        if (existing.kind === "pull-request") {
          return `Error: #${number} in '${owner}/${repoName}' is a pull request, not an issue. close_issue only operates on issues.`;
        }

        const closed = await updateIssue(token, {
          owner,
          repo: repoName,
          issueNumber: number,
          state: "closed",
        });

        context.workflow.issueOps += 1;

        return {
          issueNumber: closed.issueNumber,
          title: closed.title,
          state: closed.state,
          url: closed.url,
        };
      } catch (error) {
        return await toGitHubToolError(error, {
          token,
          userId: context.userId,
          owner,
          repo: repoName,
          operation: "closing GitHub issue",
          notFoundMessage: `Error: GitHub issue #${number} was not found in '${owner}/${repoName}' — it may not exist, or the authenticated user does not have access to it.`,
        });
      }
    },
  };
}
