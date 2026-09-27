import type {Response} from "express";
import type {AuthenticatedRequest} from "../auth/auth.types.js";
import * as userService from "../services/user.service.js";
import * as oauthService from "../services/oauth.service.js";
import {clearAuthCookie} from "../../lib/jwt.js";
import { db } from "../../lib/db.js";
import { oauthAccounts, repositories } from "@klinpi/db/schema";
import { eq, and, sql } from "drizzle-orm";

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

        res.status(200).json({user});
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

        const database = db();
        const [oauthAccount] = await database
            .select()
            .from(oauthAccounts)
            .where(
                and(
                    eq(oauthAccounts.userId, userId),
                    eq(oauthAccounts.provider, "github"),
                )
            )
            .limit(1);

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

        // Sync the fetched page into `Repository` so sessions can link to it
        // (`repositoryId` is the DB row id; `id` stays the GitHub id). The
        // listing itself is best-effort: a sync failure never breaks it.
        let linked: Array<oauthService.GitHubRepo & { repositoryId: string | null }>;
        try {
            let rows: Array<{ id: string; userId: string; providerRepoId: string }> = [];
            if (repos.length > 0) {
                rows = await database
                    .insert(repositories)
                    .values(
                        repos.map((repo) => ({
                            userId,
                            provider: "GITHUB" as const,
                            providerRepoId: String(repo.id),
                            owner: repo.owner.login,
                            name: repo.name,
                            fullName: repo.full_name,
                            cloneUrl: `https://github.com/${repo.full_name}.git`,
                            defaultBranch: repo.default_branch ?? "main",
                        })),
                    )
                    .onConflictDoUpdate({
                        target: [repositories.provider, repositories.providerRepoId],
                        set: {
                            fullName: sql`excluded."fullName"`,
                            cloneUrl: sql`excluded."cloneUrl"`,
                            defaultBranch: sql`excluded."defaultBranch"`,
                            updatedAt: new Date(),
                        },
                    })
                    .returning({
                        id: repositories.id,
                        userId: repositories.userId,
                        providerRepoId: repositories.providerRepoId,
                    });
            }
            const byProviderId = new Map(rows.map((r) => [r.providerRepoId, r]));
            linked = repos.map((repo) => {
                const row = byProviderId.get(String(repo.id));
                // A shared repo row belongs to whichever user synced it first;
                // never hand another user a repository they don't own.
                return {
                    ...repo,
                    repositoryId: row && row.userId === userId ? row.id : null,
                };
            });
        } catch (error) {
            console.error("Repository sync failed:", error);
            linked = repos.map((repo) => ({ ...repo, repositoryId: null }));
        }

        res.json({repos: linked});
    } catch (error) {
        console.error("List repos error:", error);
        res.status(500).json({error: "Internal server error"});
    }
}
