import bcrypt from "bcrypt";
import { db } from "../../lib/db.js";
import { users } from "@klinpi/db/schema";
import { eq } from "drizzle-orm";
import { cacheData } from "../../lib/cache.js";
import { cacheKeys } from "../../lib/cacheKey.js";


const SALT_ROUNDS = 12;

export async function getUserProfile(userId: string) {
    const database = db();
    const cacheKey = cacheKeys.userProfile(userId);
    const checkCache = await cacheData.getCache(cacheKey);
    if (checkCache) {
        return checkCache;
    }
    const [user] = await database
        .select({
            id: users.id,
            email: users.email,
            name: users.name,
            avatarUrl: users.avatarUrl,
            createdAt: users.createdAt,
            updatedAt: users.updatedAt,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
    if (user) {
        await cacheData.setCache(cacheKey, user, 3600);
    }
    return user ?? null;
}

export async function updateUserProfile(
    userId: string,
    data: { name?: string; email?: string; password?: string; currentPassword: string },
) {
    const database = db();
    const [user] = await database
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
    if (!user) {
        return null;
    }

    const isValidPassword = await bcrypt.compare(
        data.currentPassword,
        user.passwordHash ?? "",
    );
    if (!isValidPassword) {
        return "INVALID_PASSWORD";
    }

    if (data.email && data.email !== user.email) {
        const [existingUser] = await database
            .select()
            .from(users)
            .where(eq(users.email, data.email))
            .limit(1);
        if (existingUser) {
            return "EMAIL_IN_USE";
        }
    }

    const updateData: {
        name?: string;
        email?: string;
        passwordHash?: string;
    } = {};

    if (data.name !== undefined) {
        updateData.name = data.name;
    }
    if (data.email !== undefined) {
        updateData.email = data.email;
    }
    if (data.password !== undefined) {
        updateData.passwordHash = await bcrypt.hash(data.password, SALT_ROUNDS);
    }

    const [updatedUser] = await database
        .update(users)
        .set(updateData)
        .where(eq(users.id, userId))
        .returning({
            id: users.id,
            email: users.email,
            name: users.name,
            avatarUrl: users.avatarUrl,
            createdAt: users.createdAt,
            updatedAt: users.updatedAt,
        });

    const cacheKey = cacheKeys.userProfile(userId);
    await cacheData.deleteCache(cacheKey);

    return updatedUser ?? null;
}

export async function deleteUserProfile(userId: string, currentPassword: string) {
    const database = db();
    const [user] = await database
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
    if (!user) {
        return null;
    }

    const isValidPassword = await bcrypt.compare(
        currentPassword,
        user.passwordHash ?? "",
    );
    if (!isValidPassword) {
        return "INVALID_PASSWORD";
    }

    await database.delete(users).where(eq(users.id, userId));
    const cacheKey = cacheKeys.userProfile(userId);
    await cacheData.deleteCache(cacheKey);
    return "DELETED";
}
