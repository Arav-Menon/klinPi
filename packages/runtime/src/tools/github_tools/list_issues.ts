import type { AgentTool, ToolContext } from "../../types.js";
import { resolveToolToken } from "./github_auth.js";
import { toGitHubToolError } from "./github_errors.js";
import { resolveIssueTarget } from "./github_repo.js";
import { DEFAULT_ISSUES_PER_PAGE, listIssues } from "./github_api.js";
import {
  parseEnumField,
  parseIntegerField,
  parseOptionalString,
  parseStringArrayField,
} from "./issue_validation.js";

interface ListIssuesArgs {
  owner?: unknown;
  repo?: unknown;
  state?: unknown;
  labels?: unknown;
  assignee?: unknown;
  milestone?: unknown;
  sort?: unknown;
  direction?: unknown;
  perPage?: unknown;
  page?: unknown;
}

const ISSUE_STATES = ["open", "closed", "all"] as const;
const ISSUE_SORTS = ["created", "updated", "comments"] as const;
const SORT_DIRECTIONS = ["asc", "desc"] as const;

export function createListIssuesTool(context: ToolContext): AgentTool {
  return {
    name: "list_issues",
    description:
      "List issues from a GitHub repository of the authenticated user's connected GitHub account. Returns structured issues (number, title, state, labels, assignees, dates) — pull requests that GitHub's Issues API also returns are excluded and counted separately. Supports filters (state, labels, assignee, milestone, sort) and pagination via page/perPage; check hasMore and request the next page when needed. Read-only — it does not modify the repository, sandbox, or open pull requests.",

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
        state: {
          type: "string",
          enum: [...ISSUE_STATES],
          description: "Issue state to list: 'open', 'closed' or 'all'. Defaults to 'open'.",
        },
        labels: {
          type: "array",
          items: { type: "string" },
          description: "Only include issues that have all of these label names",
        },
        assignee: {
          type: "string",
          description:
            "Only issues assigned to this GitHub username; use 'none' for unassigned issues or '*' for any assignee",
        },
        milestone: {
          type: "number",
          description: "Only issues in this milestone (by milestone number)",
        },
        sort: {
          type: "string",
          enum: [...ISSUE_SORTS],
          description: "Field to sort by: 'created', 'updated' or 'comments'",
        },
        direction: {
          type: "string",
          enum: [...SORT_DIRECTIONS],
          description: "Sort direction: 'asc' or 'desc'",
        },
        perPage: {
          type: "number",
          description: `Number of issues per page (1-100). Defaults to ${DEFAULT_ISSUES_PER_PAGE}.`,
        },
        page: {
          type: "number",
          description: "1-based page number. Defaults to 1.",
        },
      },
      required: context.repositoryId ? [] : ["owner", "repo"],
    },

    async execute(args) {
      const listArgs = args as ListIssuesArgs;

      const target = await resolveIssueTarget(
        context,
        "list_issues",
        listArgs.owner,
        listArgs.repo,
      );
      if (!target.ok) {
        return target.error;
      }
      const state = parseEnumField(listArgs.state, "state", ISSUE_STATES);
      if (!state.ok) {
        return state.error;
      }
      const labels = parseStringArrayField(listArgs.labels, "labels");
      if (!labels.ok) {
        return labels.error;
      }
      const assignee = parseOptionalString(listArgs.assignee, "assignee");
      if (!assignee.ok) {
        return assignee.error;
      }
      const milestone = parseIntegerField(listArgs.milestone, "milestone", 1);
      if (!milestone.ok) {
        return milestone.error;
      }
      const sort = parseEnumField(listArgs.sort, "sort", ISSUE_SORTS);
      if (!sort.ok) {
        return sort.error;
      }
      const direction = parseEnumField(
        listArgs.direction,
        "direction",
        SORT_DIRECTIONS,
      );
      if (!direction.ok) {
        return direction.error;
      }
      const perPage = parseIntegerField(listArgs.perPage, "perPage", 1, 100);
      if (!perPage.ok) {
        return perPage.error;
      }
      const page = parseIntegerField(listArgs.page, "page", 1);
      if (!page.ok) {
        return page.error;
      }

      const { owner, repo: repoName } = target;

      const lookup = await resolveToolToken(context);
      if (lookup.error) {
        return lookup.error;
      }
      const token = lookup.token!;

      try {
        const listed = await listIssues(token, {
          owner,
          repo: repoName,
          state: state.value,
          labels: labels.value,
          assignee: assignee.value,
          milestone: milestone.value,
          sort: sort.value,
          direction: direction.value,
          perPage: perPage.value,
          page: page.value,
        });
        context.workflow.issueOps += 1;
        return listed;
      } catch (error) {
        return await toGitHubToolError(error, {
          token,
          userId: context.userId,
          owner,
          repo: repoName,
          operation: "listing GitHub issues",
          notFoundMessage: `Error: GitHub repository '${owner}/${repoName}' was not found or the authenticated user does not have access to it.`,
          payloadHint: "Check the filter values: labels, assignee and milestone.",
        });
      }
    },
  };
}
