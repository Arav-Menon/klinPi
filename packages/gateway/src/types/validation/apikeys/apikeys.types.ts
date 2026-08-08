import type { z } from "zod";
import type { createApiKeySchema } from "./apikeys.schema.js";

export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;
