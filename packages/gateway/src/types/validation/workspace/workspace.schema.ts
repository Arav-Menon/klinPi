import { z } from "zod";

export const workspaceFileQuerySchema = z.object({
  path: z
    .string()
    .min(1, "File path is required")
    .max(1024, "File path is too long"),
});
