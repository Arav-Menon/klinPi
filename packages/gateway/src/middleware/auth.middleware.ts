import type {Response, NextFunction} from "express";
import type {AuthenticatedRequest} from "../types/auth.types.js";
import {verifyToken, getTokenFromRequest} from "../lib/jwt.js";

export function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    const token = getTokenFromRequest(req);
    if (!token) {
        res.status(401).json({error: "Unauthorized"});
        return;
    }

    try {
        const payload = verifyToken(token);
        req.userId = payload.sub;
        next();
    } catch {
        res.status(401).json({error: "Invalid or expired token"});
    }
}
