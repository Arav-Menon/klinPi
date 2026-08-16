import { z } from "zod";

export const createSessionSchema = z.object({
  title: z.string().min(1, "Title cannot be empty").max(200).optional(),
  repositoryId: z.string().optional(),
});

export const updateSessionSchema = z.object({
  title: z.string().min(1, "Title cannot be empty").max(200).optional(),
  status: z.enum(["ACTIVE", "PAUSED", "COMPLETED", "FAILED", "ARCHIVED"]).optional(),
}).refine(
  (data) => data.title !== undefined || data.status !== undefined,
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
