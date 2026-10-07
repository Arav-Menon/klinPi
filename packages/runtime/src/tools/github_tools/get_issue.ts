import type { AgentTool, ToolContext } from "../../types.js";
import { resolveToolToken } from "./github_auth.js";
import { toGitHubToolError } from "./github_errors.js";
import { resolveIssueTarget } from "./github_repo.js";
import { getIssue } from "./github_api.js";
import { parseIssueNumber } from "./issue_validation.js";

interface GetIssueArgs {
  owner?: unknown;
  repo?: unknown;
  issueNumber?: unknown;
}

export function createGetIssueTool(context: ToolContext): AgentTool {
  return {
    name: "get_issue",
    description:
      "Retrieve a specific GitHub issue by issue number from a repository of the authenticated user's connected GitHub account. Returns structured information: number, title, body, state, url, labels, assignees, milestone, author and timestamps. If the given number is actually a pull request, the tool says so instead of returning it as an issue. Read-only.",

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
          description: "The issue number to retrieve, e.g. 42",
        },
      },
      required: context.repositoryId
        ? ["issueNumber"]
        : ["owner", "repo", "issueNumber"],
    },

    async execute(args) {
      const getArgs = args as GetIssueArgs;

      const target = await resolveIssueTarget(
        context,
        "get_issue",
        getArgs.owner,
        getArgs.repo,
      );
      if (!target.ok) {
        return target.error;
      }
      const issueNumber = parseIssueNumber(getArgs.issueNumber);
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
        const result = await getIssue(token, {
          owner,
          repo: repoName,
          issueNumber: number,
        });
        if (result.kind === "pull-request") {
          return `Error: #${number} in '${owner}/${repoName}' is a pull request, not an issue. The issue tools only operate on issues.`;
        }
        context.workflow.issueOps += 1;
        return result.issue;
      } catch (error) {
        return await toGitHubToolError(error, {
          token,
          userId: context.userId,
          owner,
          repo: repoName,
          operation: "getting GitHub issue",
          notFoundMessage: `Error: GitHub issue #${number} was not found in '${owner}/${repoName}' — it may not exist, or the authenticated user does not have access to it.`,
        });
      }
    },
  };
}
