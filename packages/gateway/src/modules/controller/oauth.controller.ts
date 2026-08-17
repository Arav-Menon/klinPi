import type { Request, Response } from "express";
import crypto from "crypto";
import * as oauthService from "../services/oauth.service.js";
import { setAuthCookie } from "../../lib/jwt.js";

const OAUTH_STATE_COOKIE = "oauth_state";
const OAUTH_STATE_MAX_AGE = 10 * 60 * 1000;
const FRONTEND_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

export async function githubLogin(_req: Request, res: Response) {
    try {
        const state = crypto.randomBytes(32).toString("hex");
        const loginUrl = oauthService.getLoginUrl("github", state);

        res.cookie(OAUTH_STATE_COOKIE, state, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            maxAge: OAUTH_STATE_MAX_AGE,
            path: "/",
        });

        res.redirect(loginUrl);
    } catch (error) {
        console.error("GitHub login error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
}

export async function githubCallback(req: Request, res: Response) {
    try {
        const { code, state } = req.query as { code?: string; state?: string };

        if (!code || !state) {
            res.status(400).json({ error: "Missing code or state parameter" });
            return;
        }

        const cookies = req.cookies as Record<string, string> | undefined;
        const savedState = cookies?.[OAUTH_STATE_COOKIE];

        res.clearCookie(OAUTH_STATE_COOKIE, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            path: "/",
        });

        if (!savedState || savedState !== state) {
            res.status(403).json({ error: "Invalid or expired OAuth state" });
            return;
        }

        const accessToken = await oauthService.exchangeCodeForToken("github", code);

        const [gitHubUser, emails] = await Promise.all([
            oauthService.getGitHubUser(accessToken),
            oauthService.getGitHubEmails(accessToken),
        ]);

        const result = await oauthService.findOrCreateOAuthUser(
            "github",
            gitHubUser,
            emails,
            accessToken,
        );

        setAuthCookie(res, result.token);

        res.redirect(`${FRONTEND_URL}`);
    } catch (error) {
        console.error("GitHub callback error:", error);
        res.redirect(`${FRONTEND_URL}?error=oauth_failed`);
    }
}
