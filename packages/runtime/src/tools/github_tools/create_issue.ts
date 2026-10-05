import type { AgentTool, ToolContext } from "../../types.js";
import {
  invalidateGitHubToken,
  resolveGitHubToken,
  sanitize,
} from "./github_auth.js";
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
  owner: string;
  repo: string;
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

  switch (true) {
    case typeof owner !== "string" ||
      !owner.trim() ||
      typeof repo !== "string" ||
      !repo.trim() ||
      typeof title !== "string" ||
      !title.trim():
      return {
        ok: false,
        error:
          "Error: 'owner', 'repo' and 'title' are required and must be non-empty strings.",
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
          owner: (owner as string).trim(),
          repo: (repo as string).trim(),
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
            "The repository owner (GitHub user or organization), e.g. 'octocat'",
        },
        repo: {
          type: "string",
          description: "The repository name, e.g. 'hello-world'",
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
      required: ["owner", "repo", "title"],
    },

    async execute(args) {
      const parsed = parseIssueInput(args as CreateIssueArgs);
      if (!parsed.ok) {
        return parsed.error;
      }
      const { owner, repo, title, body, labels, assignees, milestone } =
        parsed.input;

      if (!context.userId) {
        return "Error: no authenticated user is associated with this agent run.";
      }

      const lookup = await resolveGitHubToken(context.userId);
      if (lookup.error) {
        return lookup.error;
      }
      const token = lookup.token!;

      try {
        return await createIssue(token, {
          owner,
          repo,
          title,
          body,
          labels,
          assignees,
          milestone,
        });
      } catch (error) {
        const status = (error as { status?: number }).status;
        const rawMessage =
          error instanceof Error ? error.message : String(error);
        const message = sanitize(rawMessage, token);

        switch (status) {
          case 401:
            await invalidateGitHubToken(context.userId);
            return `Error: GitHub rejected the stored access token (401): ${message}. Reconnect GitHub and try again.`;
          case 403:
            return `Error: GitHub denied the request (403): ${message}. The token may lack the required scopes or be rate limited.`;
          case 404:
            return `Error: GitHub repository '${owner}/${repo}' was not found or the authenticated user does not have access to it.`;
          case 422:
            return `Error: GitHub rejected the issue payload (422): ${message}. Check the labels, assignees and milestone values.`;
          default:
            return `Error creating GitHub issue in '${owner}/${repo}': ${message}`;
        }
      }
    },
  };
}
