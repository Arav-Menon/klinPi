import bcrypt from "bcrypt";
import { db } from "../../lib/db.js";
import { users } from "@klinpi/db/schema";
import { eq } from "drizzle-orm";
import { signToken } from "../../lib/jwt.js";

const SALT_ROUNDS = 12;

export async function createUser(
    name: string | undefined,
    email: string,
    password: string,
) {
    const database = db();
    const [existingUser] = await database
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
    if (existingUser) {
        return null;
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const [user] = await database
        .insert(users)
        .values({
            email,
            passwordHash,
            name: name ?? null,
        })
        .returning();

    const token = signToken(user!.id);
    return {
        user: {id: user!.id, email: user!.email, name: user!.name, token: token},
        token,
    };
}

export async function authenticateUser(email: string, password: string) {
    const database = db();
    const [user] = await database
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
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
    const database = db();
    const [user] = await database
        .select({id: users.id, email: users.email, name: users.name})
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
    return user ?? null;
}
