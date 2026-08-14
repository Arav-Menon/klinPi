import type {z} from "zod";
import type {signupSchema, signinSchema} from "./auth.schema.js";

export type SignupInput = z.infer<typeof signupSchema>;
export type SigninInput = z.infer<typeof signinSchema>;
