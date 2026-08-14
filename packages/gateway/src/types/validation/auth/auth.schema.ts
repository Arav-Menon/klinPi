import {z} from "zod";

export const signupSchema = z.object({
    name: z.string().min(1, "Name is required").max(100).optional(),
    email: z.string().email("Invalid email address"),
    password: z
        .string()
        .min(8, "Password must be at least 8 characters")
        .max(128, "Password must be at most 128 characters"),
});

export const signinSchema = z.object({
    email: z.string().email("Invalid email address"),
    password: z.string().min(1, "Password is required"),
});
