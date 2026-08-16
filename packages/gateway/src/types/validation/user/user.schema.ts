import {z} from "zod";

const passwordValidation = z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password must be at most 128 characters");

export const updateProfileSchema = z.object({
    name: z.string().min(1, "Name is required").max(100),
    email: z.string().email("Invalid email address"),
    password: passwordValidation,
    currentPassword: z.string().min(1, "Current password is required"),
});

export const patchProfileSchema = z.object({
    name: z.string().min(1, "Name is required").max(100).optional(),
    email: z.string().email("Invalid email address").optional(),
    password: passwordValidation.optional(),
    currentPassword: z.string().min(1, "Current password is required"),
});

export const deleteAccountSchema = z.object({
    currentPassword: z.string().min(1, "Current password is required"),
});
