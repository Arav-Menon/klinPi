import type { AgentTool, ToolContext } from "../../types.js";
import {
  invalidateGitHubToken,
  resolveGitHubToken,
  sanitize,
} from "./github_auth.js";
import { createPullRequest, compareBranches } from "./github_api.js";
import { resolveLinkedRepository } from "./github_repo.js";

interface CreatePullRequestArgs {
  owner?: unknown;
  repo?: unknown;
  title?: unknown;
  body?: unknown;
  head?: unknown;
  base?: unknown;
}

export function createCreatePullRequestTool(context: ToolContext): AgentTool {
  return {
    name: "create_pull_request",
    description:
      "Create a GitHub Pull Request from an existing remote branch. This tool ONLY creates the Pull Request via the GitHub API — it never creates or switches branches, modifies files, executes commands, runs tests, stages, commits, or pushes. When the PR contains new implementation work, the caller must complete the implementation, validation, commit and push workflow first: call this tool as the FINAL step, only after the branch has been pushed successfully and 'head' exists on GitHub containing the committed changes. If this run already modified repository files, they must be committed and pushed before this tool will run — that precondition is enforced here. The caller never provides credentials or a user id.",

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
          description: "The title of the pull request",
        },
        body: {
          type: "string",
          description: "Optional Markdown body of the pull request",
        },
        head: {
          type: "string",
          description:
            "The source branch, already pushed to GitHub with the committed changes (e.g. 'feature/fix-login' or 'user:branch')",
        },
        base: {
          type: "string",
          description:
            "The target branch to merge into. Defaults to the linked repository's default branch when a repository is linked; usually 'main'",
        },
      },
      required: context.repositoryId
        ? ["title", "head"]
        : ["owner", "repo", "title", "head", "base"],
    },

    async execute(args) {
      const raw = args as CreatePullRequestArgs;
      const linked = await resolveLinkedRepository(context);

      const title = typeof raw.title === "string" ? raw.title.trim() : undefined;
      const head = typeof raw.head === "string" ? raw.head.trim() : undefined;
      let owner = typeof raw.owner === "string" ? raw.owner.trim() : undefined;
      let repo = typeof raw.repo === "string" ? raw.repo.trim() : undefined;
      let base = typeof raw.base === "string" ? raw.base.trim() : undefined;
      const body = raw.body;

      if (linked) {
        if (owner !== undefined && owner.toLowerCase() !== linked.owner.toLowerCase()) {
          return `Error: this session is linked to repository '${linked.fullName}' — create_pull_request only opens pull requests against the linked repository (expected owner '${linked.owner}', got '${owner}').`;
        }
        if (repo !== undefined && repo.toLowerCase() !== linked.repo.toLowerCase()) {
          return `Error: this session is linked to repository '${linked.fullName}' — create_pull_request only opens pull requests against the linked repository (expected repo '${linked.repo}', got '${repo}').`;
        }
        owner = linked.owner;
        repo = linked.repo;
        if (base === undefined || base === "") {
          base = linked.defaultBranch;
        }
      }

      if (!owner || !repo || !title || !head || !base) {
        return linked
          ? "Error: 'title' and 'head' are required and must be non-empty strings."
          : "Error: 'owner', 'repo', 'title', 'head' and 'base' are required and must be non-empty strings.";
      }
      if (body !== undefined && typeof body !== "string") {
        return "Error: 'body' must be a string.";
      }

      if (!context.userId) {
        return "Error: no authenticated user is associated with this agent run.";
      }

      // Precondition: changes made in this run must be on GitHub. A pull
      // request opened before the push would silently omit them, so refuse
      // until a successful git_push has recorded the current state.
      const { workflow } = context;
      if (workflow.writeCount > workflow.writesAtLastPush) {
        const written = [...workflow.writtenPaths];
        const shown = written.slice(0, 3).join(", ");
        const more = written.length > 3 ? ` and ${written.length - 3} more` : "";
        return (
          `Error: this run modified ${workflow.writeCount} file(s) (${shown}${more}) that have not been pushed yet, ` +
          "so a pull request would not contain them. Stage the intended files (git_stage), commit them (git_commit), " +
          "push the branch (git_push), then call create_pull_request again. " +
          "If the changes were already pushed by other means, call git_push once to confirm the branch is up to date and retry."
        );
      }

      const lookup = await resolveGitHubToken(context.userId);
      if (lookup.error) {
        return lookup.error;
      }
      const token = lookup.token!;

      // Precondition: 'head' must already exist on GitHub with commits ahead
      // of 'base' — i.e. the branch has been pushed after implementation,
      // validation and commit. This tool is only the final GitHub API step of
      // the PR workflow and refuses to run before the push happened.
      try {
        const comparison = await compareBranches(token, { owner, repo, base, head });
        if (comparison.aheadBy <= 0) {
          return `Error: branch '${head}' has no commits ahead of '${base}' on GitHub. Complete the workflow first: implement the changes, stage, commit, and push '${head}', then call create_pull_request again.`;
        }
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
            return `Error: GitHub repository '${owner}/${repo}' or branch '${head}'/'${base}' was not found, or you do not have access to it. create_pull_request only works when the head branch already exists on GitHub — implement the changes, commit them, and push '${head}' before calling this tool.`;
          case 422:
            return `Error: GitHub rejected the branch comparison (422): ${message}. Check that 'head' and 'base' are valid, different branches that exist on GitHub.`;
          default:
            return `Error comparing branches in '${owner}/${repo}': ${message}`;
        }
      }

      try {
        const pullRequest = await createPullRequest(token, {
          owner,
          repo,
          title,
          body,
          head,
          base,
        });
        workflow.prCreated = true;
        return pullRequest;
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
            return `Error: GitHub repository or branch '${owner}/${repo}' was not found or the authenticated user does not have access to it.`;
          case 422:
            return `Error: GitHub rejected the pull request payload (422): ${message}. Check that 'head' and 'base' are valid, different branches that exist on GitHub.`;
          default:
            return `Error creating GitHub pull request in '${owner}/${repo}': ${message}`;
        }
      }
    },
  };
}
