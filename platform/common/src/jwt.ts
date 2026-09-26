import jwt from "jsonwebtoken";
import { JWT_SECRET } from "./env.js";

const JWT_EXPIRES_IN = "15m";

function getJwtSecret(): string {
    if (!JWT_SECRET) {
        throw new Error("JWT_SECRET environment variable is required");
    }
    return JWT_SECRET;
}

export interface JwtPayload {
    sub: string;
}

export function signToken(userId: string): string {
    const payload: JwtPayload = { sub: userId };
    return jwt.sign(payload, getJwtSecret(), { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token: string): JwtPayload {
    return jwt.verify(token, getJwtSecret()) as JwtPayload;
}
