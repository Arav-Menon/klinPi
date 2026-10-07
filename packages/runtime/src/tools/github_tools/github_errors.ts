import { invalidateGitHubToken, sanitize } from "./github_auth.js";

export interface GitHubToolErrorContext {
  token: string;
  userId: string;
  owner: string;
  repo: string;
  /** What the tool was doing, e.g. "creating GitHub issue" (used for unexpected errors). */
  operation: string;
  /** Message returned when GitHub responds 404 — differs per tool. */
  notFoundMessage: string;
  /** Guidance appended to 422 payload-validation errors. */
  payloadHint?: string | undefined;
}

/**
 * Map a GitHub API failure to a sanitized, agent-friendly error string.
 * Never exposes the access token; a 401 invalidates the cached token.
 */
export async function toGitHubToolError(
  error: unknown,
  context: GitHubToolErrorContext,
): Promise<string> {
  const status = (error as { status?: number }).status;
  const rawMessage = error instanceof Error ? error.message : String(error);
  const message = sanitize(rawMessage, context.token);

  switch (status) {
    case 401:
      await invalidateGitHubToken(context.userId);
      return `Error: GitHub rejected the stored access token (401): ${message}. Reconnect GitHub and try again.`;
    case 403:
      return `Error: GitHub denied the request (403): ${message}. The token may lack the required scopes or be rate limited.`;
    case 404:
      return context.notFoundMessage;
    case 422:
      return `Error: GitHub rejected the issue payload (422): ${message}. ${context.payloadHint ?? "Check the labels, assignees and milestone values."}`;
    default:
      return `Error ${context.operation} in '${context.owner}/${context.repo}': ${message}`;
  }
}
