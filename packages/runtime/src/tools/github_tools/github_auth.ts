import { cache } from "@klinpi/redis";
import { getDb, schema } from "@klinpi/db";
import { and, eq } from "drizzle-orm";
import type { ToolContext } from "../../types.js";

const TOKEN_CACHE_PREFIX = "github:access-token:";
const TOKEN_CACHE_TTL_SECONDS = 60 * 60;

export function tokenCacheKey(userId: string): string {
  return `${TOKEN_CACHE_PREFIX}${userId}`;
}

export function sanitize(text: string, token?: string | undefined): string {
  let out = text.replace(/x-access-token:[^@\s]*@/g, "x-access-token:***@");
  out = out.replace(/Bearer\s+\S+/gi, "Bearer ***");
  if (token) {
    out = out.split(token).join("***");
    const encoded = encodeURIComponent(token);
    if (encoded !== token) {
      out = out.split(encoded).join("***");
    }
  }
  return out;
}

export type TokenLookup =
  | { token: string; error?: undefined }
  | { token?: undefined; error: string };

export async function resolveGitHubToken(userId: string): Promise<TokenLookup> {
  const cacheKey = tokenCacheKey(userId);

  try {
    const cached = await cache.getCache(cacheKey);
    if (typeof cached === "string" && cached.length > 0) {
      return { token: cached };
    }
  } catch {
    // RedisCache already logs internally; fall through to the database.
  }

  let rows: Array<{ accessToken: string | null }>;
  try {
    const db = getDb();
    rows = await db
      .select({ accessToken: schema.oauthAccounts.accessToken })
      .from(schema.oauthAccounts)
      .where(
        and(
          eq(schema.oauthAccounts.userId, userId),
          eq(schema.oauthAccounts.provider, "github"),
        ),
      )
      .limit(1);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      error: `Error looking up GitHub credentials: ${sanitize(message)}`,
    };
  }

  const token = rows[0]?.accessToken;
  if (!token) {
    return {
      error:
        "Error: no GitHub account is connected for this user. Connect GitHub before using GitHub tools.",
    };
  }

  try {
    await cache.setCache(cacheKey, token, TOKEN_CACHE_TTL_SECONDS);
  } catch {
    // Caching is best-effort; the token itself is still usable.
  }

  return { token };
}

/**
 * Resolve the GitHub token for an agent-tool run. The identity always comes
 * from the authenticated tool context — never from model-provided arguments.
 */
export async function resolveToolToken(context: ToolContext): Promise<TokenLookup> {
  if (!context.userId) {
    return { error: "Error: no authenticated user is associated with this agent run." };
  }
  return resolveGitHubToken(context.userId);
}

export async function invalidateGitHubToken(userId: string): Promise<void> {
  try {
    await cache.deleteCache(tokenCacheKey(userId));
  } catch {
    // Best-effort invalidation; a stale token is refreshed on the next 401.
  }
}
