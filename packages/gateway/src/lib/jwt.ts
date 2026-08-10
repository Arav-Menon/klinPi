import jwt from "jsonwebtoken";
import type {Response, Request} from "express";

const JWT_EXPIRES_IN = "15m";
const COOKIE_NAME = "klinpi_token";

function getJwtSecret(): string {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
        throw new Error("JWT_SECRET environment variable is required");
    }
    return secret;
}

export interface JwtPayload {
    sub: string;
}

export function signToken(userId: string): string {
    const payload: JwtPayload = {sub: userId};
    return jwt.sign(payload, getJwtSecret(), {expiresIn: JWT_EXPIRES_IN});
}

export function verifyToken(token: string): JwtPayload {
    return jwt.verify(token, getJwtSecret()) as JwtPayload;
}

export function setAuthCookie(res: Response, token: string): void {
    res.cookie(COOKIE_NAME, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 15 * 60 * 1000,
        path: "/",
    });
}

export function clearAuthCookie(res: Response): void {
    res.clearCookie(COOKIE_NAME, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
    });
}

export function getTokenFromRequest(req: Request): string | null {
    const cookies = req.cookies as Record<string, string> | undefined;
    if (cookies && cookies[COOKIE_NAME]) {
        return cookies[COOKIE_NAME];
    }

    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
        return authHeader.slice(7);
    }

    return null;
}
