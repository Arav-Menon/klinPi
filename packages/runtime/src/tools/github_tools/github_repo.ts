import { getDb, schema } from "@klinpi/db";
import { eq } from "drizzle-orm";
import type { ToolContext } from "../../types.js";

export interface LinkedRepository {
  owner: string;
  repo: string;
  fullName: string;
  defaultBranch: string;
}

export async function resolveLinkedRepository(
  context: ToolContext,
): Promise<LinkedRepository | null> {
  if (!context.repositoryId) {
    return null;
  }
  try {
    const db = getDb();
    const [row] = await db
      .select()
      .from(schema.repositories)
      .where(eq(schema.repositories.id, context.repositoryId))
      .limit(1);
    if (!row || typeof row.fullName !== "string") {
      return null;
    }
    const [owner, repo] = row.fullName.split("/");
    if (!owner || !repo) {
      return null;
    }
    const defaultBranch =
      typeof row.defaultBranch === "string" && row.defaultBranch.trim()
        ? row.defaultBranch.trim()
        : "main";
    return { owner, repo, fullName: row.fullName, defaultBranch };
  } catch {
    return null;
  }
}

export type IssueTarget =
  | { ok: true; owner: string; repo: string; error?: undefined }
  | { ok: false; owner?: undefined; repo?: undefined; error: string };

/**
 * Resolve the owner/repo an issue tool should act on.
 *
 * - Session linked to a repository: owner/repo are optional and default to the
 *   linked repository; provided values must match it (case-insensitive), like
 *   create_pull_request, so a hallucinated owner/repo comes back as a
 *   corrective error that names the real repository instead of a GitHub 404.
 * - No linked repository: owner and repo are required from the caller.
 */
export async function resolveIssueTarget(
  context: ToolContext,
  toolName: string,
  owner?: unknown,
  repo?: unknown,
): Promise<IssueTarget> {
  const ownerProvided = owner !== undefined;
  const repoProvided = repo !== undefined;
  const ownerValid =
    !ownerProvided || (typeof owner === "string" && owner.trim().length > 0);
  const repoValid =
    !repoProvided || (typeof repo === "string" && repo.trim().length > 0);

  const linked = await resolveLinkedRepository(context);

  if (!linked) {
    if (!ownerProvided || !repoProvided || !ownerValid || !repoValid) {
      return {
        ok: false,
        error:
          "Error: 'owner' and 'repo' are required and must be non-empty strings.",
      };
    }
    return {
      ok: true,
      owner: (owner as string).trim(),
      repo: (repo as string).trim(),
    };
  }

  if (!ownerValid) {
    return {
      ok: false,
      error: "Error: 'owner' must be a non-empty string when provided.",
    };
  }
  if (!repoValid) {
    return {
      ok: false,
      error: "Error: 'repo' must be a non-empty string when provided.",
    };
  }
  if (
    ownerProvided &&
    (owner as string).trim().toLowerCase() !== linked.owner.toLowerCase()
  ) {
    return {
      ok: false,
      error: `Error: this session is linked to repository '${linked.fullName}' — ${toolName} only works on the linked repository (expected owner '${linked.owner}', got '${(owner as string).trim()}'). Set owner to '${linked.owner}' and repo to '${linked.repo}', or omit owner and repo.`,
    };
  }
  if (
    repoProvided &&
    (repo as string).trim().toLowerCase() !== linked.repo.toLowerCase()
  ) {
    return {
      ok: false,
      error: `Error: this session is linked to repository '${linked.fullName}' — ${toolName} only works on the linked repository (expected repo '${linked.repo}', got '${(repo as string).trim()}'). Set owner to '${linked.owner}' and repo to '${linked.repo}', or omit owner and repo.`,
    };
  }

  return { ok: true, owner: linked.owner, repo: linked.repo };
}
