import type { AgentTool, ToolContext } from "../../types.js";
import { resolveToolToken } from "./github_auth.js";
import { toGitHubToolError } from "./github_errors.js";
import { resolveIssueTarget } from "./github_repo.js";
import { createIssue } from "./github_api.js";

interface CreateIssueArgs {
  owner?: unknown;
  repo?: unknown;
  title?: unknown;
  body?: unknown;
  labels?: unknown;
  assignees?: unknown;
  milestone?: unknown;
}

interface IssueInput {
  owner?: string | undefined;
  repo?: string | undefined;
  title: string;
  body?: string | undefined;
  labels?: string[] | undefined;
  assignees?: string[] | undefined;
  milestone?: number | undefined;
}

type ParsedIssueInput =
  | { ok: true; input: IssueInput; error?: undefined }
  | { ok: false; input?: undefined; error: string };

function parseIssueInput(args: CreateIssueArgs): ParsedIssueInput {
  const { owner, repo, title, body, labels, assignees, milestone } = args;

  // owner/repo are optional when a repository is linked to the session
  // (resolved in execute) — validate the type when they are provided.
  const ownerInvalid =
    owner !== undefined &&
    (typeof owner !== "string" || !owner.trim());
  const repoInvalid =
    repo !== undefined && (typeof repo !== "string" || !repo.trim());
  const titleInvalid = typeof title !== "string" || !title.trim();

  switch (true) {
    case titleInvalid &&
      (owner === undefined ||
        repo === undefined ||
        ownerInvalid ||
        repoInvalid):
      // Preserve the legacy combined message for the common case where the
      // caller supplied none of the required fields.
      return {
        ok: false,
        error:
          "Error: 'owner', 'repo' and 'title' are required and must be non-empty strings.",
      };
    case titleInvalid:
      return {
        ok: false,
        error: "Error: 'title' is required and must be a non-empty string.",
      };
    case ownerInvalid:
      return {
        ok: false,
        error: "Error: 'owner' must be a non-empty string when provided.",
      };
    case repoInvalid:
      return {
        ok: false,
        error: "Error: 'repo' must be a non-empty string when provided.",
      };
    case body !== undefined && typeof body !== "string":
      return { ok: false, error: "Error: 'body' must be a string." };
    case labels !== undefined &&
      (!Array.isArray(labels) || labels.some((label) => typeof label !== "string")):
      return {
        ok: false,
        error: "Error: 'labels' must be an array of strings.",
      };
    case assignees !== undefined &&
      (!Array.isArray(assignees) ||
        assignees.some((assignee) => typeof assignee !== "string")):
      return {
        ok: false,
        error: "Error: 'assignees' must be an array of strings.",
      };
    case milestone !== undefined &&
      (typeof milestone !== "number" ||
        !Number.isInteger(milestone) ||
        milestone < 1):
      return {
        ok: false,
        error: "Error: 'milestone' must be a positive integer.",
      };
    default:
      return {
        ok: true,
        input: {
          owner: typeof owner === "string" ? owner.trim() : undefined,
          repo: typeof repo === "string" ? repo.trim() : undefined,
          title: (title as string).trim(),
          body: body as string | undefined,
          labels: labels as string[] | undefined,
          assignees: assignees as string[] | undefined,
          milestone: milestone as number | undefined,
        },
      };
  }
}

export function createCreateIssueTool(context: ToolContext): AgentTool {
  return {
    name: "create_issue",
    description:
      "Create an issue in a GitHub repository using the authenticated user's connected GitHub account. This tool ONLY performs the GitHub API issue creation operation — it does not touch the sandbox, modify repository files, create branches, run commands, or create pull requests. Generate a useful title and body from the user's request. The caller never provides credentials or a user id.",

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
        title: {
          type: "string",
          description: "The title of the issue",
        },
        body: {
          type: "string",
          description: "Optional Markdown body of the issue",
        },
        labels: {
          type: "array",
          items: { type: "string" },
          description: "Optional label names to apply to the issue",
        },
        assignees: {
          type: "array",
          items: { type: "string" },
          description: "Optional GitHub usernames to assign to the issue",
        },
        milestone: {
          type: "number",
          description: "Optional milestone number to associate with the issue",
        },
      },
      required: context.repositoryId ? ["title"] : ["owner", "repo", "title"],
    },

    async execute(args) {
      const parsed = parseIssueInput(args as CreateIssueArgs);
      if (!parsed.ok) {
        return parsed.error;
      }
      const { title, body, labels, assignees, milestone } = parsed.input;

      const target = await resolveIssueTarget(
        context,
        "create_issue",
        parsed.input.owner,
        parsed.input.repo,
      );
      if (!target.ok) {
        return target.error;
      }
      const { owner, repo } = target;

      const lookup = await resolveToolToken(context);
      if (lookup.error) {
        return lookup.error;
      }
      const token = lookup.token!;

      try {
        const created = await createIssue(token, {
          owner,
          repo,
          title,
          body,
          labels,
          assignees,
          milestone,
        });
        context.workflow.issueOps += 1;
        return created;
      } catch (error) {
        return await toGitHubToolError(error, {
          token,
          userId: context.userId,
          owner,
          repo,
          operation: "creating GitHub issue",
          notFoundMessage: `Error: GitHub repository '${owner}/${repo}' was not found or the authenticated user does not have access to it.`,
        });
      }
    },
  };
}
