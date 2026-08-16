import bcrypt from "bcrypt";
import {prisma} from "../../lib/prisma.js";
import {signToken} from "../../lib/jwt.js";

const SALT_ROUNDS = 12;

export async function createUser(
    name: string | undefined,
    email: string,
    password: string,
) {
    const db = prisma();
    const existingUser = await db.user.findUnique({where: {email}});
    if (existingUser) {
        return null;
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await db.user.create({
        data: {
            email,
            passwordHash,
            name: name ?? null,
        },
    });

    const token = signToken(user.id);
    return {
        user: {id: user.id, email: user.email, name: user.name, token: token},
        token,
    };
}

export async function authenticateUser(email: string, password: string) {
    const db = prisma();
    const user = await db.user.findUnique({where: {email}});
    if (!user) {
        return null;
    }

    const isValidPassword = await bcrypt.compare(password, user.passwordHash ?? "");
    if (!isValidPassword) {
        return null;
    }

    const token = signToken(user.id);
    return {user: {id: user.id, email: user.email, name: user.name, token: token}, token};
}

export async function getUserById(userId: string) {
    const db = prisma();
    const user = await db.user.findUnique({
        where: {id: userId},
        select: {id: true, email: true, name: true},
    });
    return user;
}
