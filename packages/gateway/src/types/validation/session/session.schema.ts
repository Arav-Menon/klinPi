import { z } from "zod";

export const createSessionSchema = z.object({
  title: z.string().min(1, "Title cannot be empty").max(200).optional(),
  repositoryId: z.string().optional(),
  /**
   * Initial user prompt. When present the gateway derives a deterministic
   * title (unless one is supplied) and persists the USER message in the
   * same transaction as the session insert.
   */
  prompt: z.string().min(1, "Prompt cannot be empty").max(4000).optional(),
});

export const updateSessionSchema = z.object({
  title: z.string().min(1, "Title cannot be empty").max(200).optional(),
  status: z.enum(["ACTIVE", "PAUSED", "COMPLETED", "FAILED", "ARCHIVED"]).optional(),
  /**
   * Bind a repository to a session that has none. A session's repository
   * is set once and immutable afterwards (enforced server-side).
   */
  repositoryId: z.string().optional(),
}).refine(
  (data) => data.title !== undefined || data.status !== undefined || data.repositoryId !== undefined,
  { message: "At least one field must be provided" },
);

export const recentSessionsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export const searchSessionsSchema = z.object({
  q: z.string().min(1, "Search query is required").max(200),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const messagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
