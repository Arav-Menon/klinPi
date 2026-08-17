import type {Response} from "express";
import type {AuthenticatedRequest} from "../auth/auth.types.js";
import * as userService from "../services/user.service.js";
import * as oauthService from "../services/oauth.service.js";
import {clearAuthCookie} from "../../lib/jwt.js";
import {prisma} from "../../lib/prisma.js";

export async function getProfile(req: AuthenticatedRequest, res: Response) {
    try {
        const userId = req.userId;
        if (!userId) {
            res.status(401).json({error: "Unauthorized"});
            return;
        }

        const user = await userService.getUserProfile(userId);
        if (!user) {
            res.status(404).json({error: "User not found"});
            return;
        }

        res.json({user});
    } catch (error) {
        console.error("Get profile error:", error);
        res.status(500).json({error: "Internal server error"});
    }
}

export async function updateProfile(req: AuthenticatedRequest, res: Response) {
    try {
        const userId = req.userId;
        if (!userId) {
            res.status(401).json({error: "Unauthorized"});
            return;
        }

        const {name, email, password, currentPassword} = req.body;
        const result = await userService.updateUserProfile(userId, {
            name,
            email,
            password,
            currentPassword,
        });

        if (result === null) {
            res.status(404).json({error: "User not found"});
            return;
        }
        if (result === "INVALID_PASSWORD") {
            res.status(401).json({error: "Invalid current password"});
            return;
        }
        if (result === "EMAIL_IN_USE") {
            res.status(409).json({error: "Email is already in use"});
            return;
        }

        res.json({user: result});
    } catch (error) {
        console.error("Update profile error:", error);
        res.status(500).json({error: "Internal server error"});
    }
}

export async function patchProfile(req: AuthenticatedRequest, res: Response) {
    try {
        const userId = req.userId;
        if (!userId) {
            res.status(401).json({error: "Unauthorized"});
            return;
        }

        const {name, email, password, currentPassword} = req.body;
        const result = await userService.updateUserProfile(userId, {
            name,
            email,
            password,
            currentPassword,
        });

        if (result === null) {
            res.status(404).json({error: "User not found"});
            return;
        }
        if (result === "INVALID_PASSWORD") {
            res.status(401).json({error: "Invalid current password"});
            return;
        }
        if (result === "EMAIL_IN_USE") {
            res.status(409).json({error: "Email is already in use"});
            return;
        }

        res.json({user: result});
    } catch (error) {
        console.error("Patch profile error:", error);
        res.status(500).json({error: "Internal server error"});
    }
}

export async function deleteProfile(req: AuthenticatedRequest, res: Response) {
    try {
        const userId = req.userId;
        if (!userId) {
            res.status(401).json({error: "Unauthorized"});
            return;
        }

        const {currentPassword} = req.body;
        const result = await userService.deleteUserProfile(userId, currentPassword);

        if (result === null) {
            res.status(404).json({error: "User not found"});
            return;
        }
        if (result === "INVALID_PASSWORD") {
            res.status(401).json({error: "Invalid current password"});
            return;
        }

        clearAuthCookie(res);
        res.json({message: "Account deleted successfully"});
    } catch (error) {
        console.error("Delete profile error:", error);
        res.status(500).json({error: "Internal server error"});
    }
}

export async function listRepos(req: AuthenticatedRequest, res: Response) {
    try {
        const userId = req.userId;
        if (!userId) {
            res.status(401).json({error: "Unauthorized"});
            return;
        }

        const db = prisma();
        const oauthAccount = await db.oAuthAccount.findFirst({
            where: {
                userId,
                provider: "github",
            },
        });

        if (!oauthAccount || !oauthAccount.accessToken) {
            res.status(404).json({error: "GitHub account not connected"});
            return;
        }

        const page = Number((req.query as Record<string, string>).page) || 1;
        const perPage = Math.min(Number((req.query as Record<string, string>).per_page) || 30, 100);

        const repos = await oauthService.getGitHubRepos(
            oauthAccount.accessToken,
            page,
            perPage,
        );

        res.json({repos});
    } catch (error) {
        console.error("List repos error:", error);
        res.status(500).json({error: "Internal server error"});
    }
}
