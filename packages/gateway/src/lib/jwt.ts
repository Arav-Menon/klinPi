import type {Response, Request} from "express";
import {signToken, verifyToken, type JwtPayload} from "@klinpi/common";

export {signToken, verifyToken, type JwtPayload};

const COOKIE_NAME = "klinpi_token";

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
