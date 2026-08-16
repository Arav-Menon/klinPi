import bcrypt from "bcrypt";
import { prisma } from "../../lib/prisma.js";
import { cacheData } from "../../lib/cache.js";
import { cacheKeys } from "../../lib/cacheKey.js";


const SALT_ROUNDS = 12;

export async function getUserProfile(userId: string) {
    const db = prisma();
    const cacheKey = cacheKeys.userProfile(userId);
    const checkCache = await cacheData.getCache(cacheKey);
    if (checkCache) {
        return checkCache;
    }
    const user = await db.user.findUnique({
        where: { id: userId },
        select: {
            id: true,
            email: true,
            name: true,
            avatarUrl: true,
            createdAt: true,
            updatedAt: true,
        },
    });
    if (user) {
        await cacheData.setCache(cacheKey, user, 3600);
    }
    return user;
}

export async function updateUserProfile(
    userId: string,
    data: { name?: string; email?: string; password?: string; currentPassword: string },
) {
    const db = prisma();
    const user = await db.user.findUnique({ where: { id: userId } });
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
        const existingUser = await db.user.findUnique({ where: { email: data.email } });
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

    const updatedUser = await db.user.update({
        where: { id: userId },
        data: updateData,
        select: {
            id: true,
            email: true,
            name: true,
            avatarUrl: true,
            createdAt: true,
            updatedAt: true,
        },
    });

    const cacheKey = cacheKeys.userProfile(userId);
    await cacheData.deleteCache(cacheKey);

    return updatedUser;
}

export async function deleteUserProfile(userId: string, currentPassword: string) {
    const db = prisma();
    const user = await db.user.findUnique({ where: { id: userId } });
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

    await db.user.delete({ where: { id: userId } });
    const cacheKey = cacheKeys.userProfile(userId);
    await cacheData.deleteCache(cacheKey);
    return "DELETED";
}
