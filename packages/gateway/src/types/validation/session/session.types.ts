import { z } from "zod";
import type {
  createSessionSchema,
  updateSessionSchema,
  recentSessionsSchema,
  searchSessionsSchema,
} from "./session.schema.js";

export type CreateSessionInput = z.infer<typeof createSessionSchema>;
export type UpdateSessionInput = z.infer<typeof updateSessionSchema>;
export type RecentSessionsInput = z.infer<typeof recentSessionsSchema>;
export type SearchSessionsInput = z.infer<typeof searchSessionsSchema>;
