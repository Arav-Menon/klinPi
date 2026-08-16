import type {z} from "zod";
import type {updateProfileSchema, patchProfileSchema, deleteAccountSchema} from "./user.schema.js";

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type PatchProfileInput = z.infer<typeof patchProfileSchema>;
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;
