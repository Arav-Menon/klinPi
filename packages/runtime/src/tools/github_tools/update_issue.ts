import type { AgentTool, ToolContext } from "../../types.js";
import { resolveToolToken } from "./github_auth.js";
import { toGitHubToolError } from "./github_errors.js";
import { resolveIssueTarget } from "./github_repo.js";
import { getIssue, updateIssue } from "./github_api.js";
import {
  parseEnumField,
  parseIntegerField,
  parseIssueNumber,
  parseOptionalNonEmptyString,
  parseOptionalString,
  parseStringArrayField,
} from "./issue_validation.js";

interface UpdateIssueArgs {
  owner?: unknown;
  repo?: unknown;
  issueNumber?: unknown;
  title?: unknown;
  body?: unknown;
  state?: unknown;
  labels?: unknown;
  assignees?: unknown;
  milestone?: unknown;
}

const UPDATABLE_STATES = ["open", "closed"] as const;

export function createUpdateIssueTool(context: ToolContext): AgentTool {
  return {
    name: "update_issue",
    description:
      "Update an existing GitHub issue. Only the fields you provide are changed — omitted fields are left untouched by GitHub. Supported fields: title, body, state ('open' or 'closed'), labels, assignees and milestone. labels/assignees replace the full current set when provided (use an empty array to clear them). The issue number must refer to a real issue, not a pull request.",

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
          description: "The issue number to update, e.g. 42",
        },
        title: {
          type: "string",
          description: "Optional new title of the issue",
        },
        body: {
          type: "string",
          description: "Optional new Markdown body of the issue",
        },
        state: {
          type: "string",
          enum: [...UPDATABLE_STATES],
          description: "Optional new state: 'open' or 'closed'",
        },
        labels: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional label names; replaces the current labels entirely (empty array clears them)",
        },
        assignees: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional GitHub usernames; replaces the current assignees entirely (empty array clears them)",
        },
        milestone: {
          type: "number",
          description: "Optional milestone number to move the issue to",
        },
      },
      required: context.repositoryId
        ? ["issueNumber"]
        : ["owner", "repo", "issueNumber"],
    },

    async execute(args) {
      const updateArgs = args as UpdateIssueArgs;

      const target = await resolveIssueTarget(
        context,
        "update_issue",
        updateArgs.owner,
        updateArgs.repo,
      );
      if (!target.ok) {
        return target.error;
      }
      const issueNumber = parseIssueNumber(updateArgs.issueNumber);
      if (!issueNumber.ok) {
        return issueNumber.error;
      }
      const title = parseOptionalNonEmptyString(updateArgs.title, "title");
      if (!title.ok) {
        return title.error;
      }
      const body = parseOptionalString(updateArgs.body, "body");
      if (!body.ok) {
        return body.error;
      }
      const state = parseEnumField(updateArgs.state, "state", UPDATABLE_STATES);
      if (!state.ok) {
        return state.error;
      }
      const labels = parseStringArrayField(updateArgs.labels, "labels");
      if (!labels.ok) {
        return labels.error;
      }
      const assignees = parseStringArrayField(
        updateArgs.assignees,
        "assignees",
      );
      if (!assignees.ok) {
        return assignees.error;
      }
      const milestone = parseIntegerField(updateArgs.milestone, "milestone", 1);
      if (!milestone.ok) {
        return milestone.error;
      }

      if (
        title.value === undefined &&
        body.value === undefined &&
        state.value === undefined &&
        labels.value === undefined &&
        assignees.value === undefined &&
        milestone.value === undefined
      ) {
        return "Error: provide at least one field to update: 'title', 'body', 'state', 'labels', 'assignees' or 'milestone'.";
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
          return `Error: #${number} in '${owner}/${repoName}' is a pull request, not an issue. update_issue only operates on issues.`;
        }

        const updated = await updateIssue(token, {
          owner,
          repo: repoName,
          issueNumber: number,
          title: title.value,
          body: body.value,
          state: state.value,
          labels: labels.value,
          assignees: assignees.value,
          milestone: milestone.value,
        });
        context.workflow.issueOps += 1;
        return updated;
      } catch (error) {
        return await toGitHubToolError(error, {
          token,
          userId: context.userId,
          owner,
          repo: repoName,
          operation: "updating GitHub issue",
          notFoundMessage: `Error: GitHub issue #${number} was not found in '${owner}/${repoName}' — it may not exist, or the authenticated user does not have access to it.`,
          payloadHint:
            "Check the 'state', labels, assignees and milestone values.",
        });
      }
    },
  };
}
