import axios from "axios";
import { OauthProvider, type OauthProviderConfig } from "../../lib/provider.js";
import { db } from "../../lib/db.js";
import { users, oauthAccounts } from "@klinpi/db/schema";
import { eq, and } from "drizzle-orm";
import { signToken } from "../../lib/jwt.js";

export function getProvider(provider: string): OauthProviderConfig {
    const config = OauthProvider[provider];
    if (!config) {
        throw new Error("Provider not supported");
    }
    return config;
}

export function getLoginUrl(provider: string, state?: string): string {
    const config = getProvider(provider);

    const params = new URLSearchParams({
        client_id: config.clientId,
        scope: config.scopes.join(" "),
        redirect_uri: config.redirectUri,
    });
    if (config.responseType) {
        params.set("response_type", config.responseType);
    }
    if (config.accessType) {
        params.set("access_type", config.accessType);
    }
    if (config.prompt) {
        params.set("prompt", config.prompt);
    }
    if (state) {
        params.set("state", state);
    }

    return `${config.authUrl}?${params.toString()}`;
}

export async function exchangeCodeForToken(
    provider: string,
    code: string,
): Promise<string> {
    const config = getProvider(provider);

    const response = await axios.post(
        config.tokenUrl,
        {
            client_id: config.clientId,
            client_secret: config.clientSecret,
            code,
        },
        {
            headers: {
                Accept: "application/json",
            },
        },
    );

    const data = response.data as { access_token?: string; error?: string };
    if (data.error || !data.access_token) {
        throw new Error(data.error ?? "Failed to exchange code for token");
    }

    return data.access_token;
}

export interface GitHubUser {
    id: number;
    login: string;
    name: string | null;
    email: string | null;
    avatar_url: string | null;
}

export interface GitHubEmail {
    email: string;
    primary: boolean;
    verified: boolean;
    visibility: string | null;
}

export async function getGitHubUser(accessToken: string): Promise<GitHubUser> {
    const response = await axios.get<GitHubUser>("https://api.github.com/user", {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
        },
    });
    return response.data;
}

export async function getGitHubEmails(accessToken: string): Promise<GitHubEmail[]> {
    const response = await axios.get<GitHubEmail[]>("https://api.github.com/user/emails", {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
        },
    });
    return response.data;
}

export async function findOrCreateOAuthUser(
    provider: string,
    gitHubUser: GitHubUser,
    emails: GitHubEmail[],
    accessToken: string,
): Promise<{ user: { id: string; email: string; name: string | null; avatarUrl: string | null }; token: string }> {
    const database = db();
    const providerAccountId = String(gitHubUser.id);

    const [existingAccount] = await database
        .select()
        .from(oauthAccounts)
        .innerJoin(users, eq(oauthAccounts.userId, users.id))
        .where(
            and(
                eq(oauthAccounts.provider, provider),
                eq(oauthAccounts.providerAccountId, providerAccountId),
            )
        )
        .limit(1);

    if (existingAccount) {
        await database
            .update(oauthAccounts)
            .set({ accessToken })
            .where(eq(oauthAccounts.id, existingAccount.OAuthAccount.id));

        const token = signToken(existingAccount.OAuthAccount.userId);
        return {
            user: {
                id: existingAccount.User.id,
                email: existingAccount.User.email,
                name: existingAccount.User.name,
                avatarUrl: existingAccount.User.avatarUrl,
            },
            token,
        };
    }

    const primaryEmail =
        emails.find((e) => e.primary && e.verified)?.email ??
        emails.find((e) => e.verified)?.email ??
        gitHubUser.email;

    if (!primaryEmail) {
        throw new Error("No verified email found from GitHub");
    }

    const [existingUser] = await database
        .select()
        .from(users)
        .where(eq(users.email, primaryEmail))
        .limit(1);

    let userId: string;

    if (existingUser) {
        userId = existingUser.id;
        await database.insert(oauthAccounts).values({
            userId,
            provider,
            providerAccountId,
            accessToken,
        });
    } else {
        const [newUser] = await database
            .insert(users)
            .values({
                email: primaryEmail,
                name: gitHubUser.name ?? gitHubUser.login,
                avatarUrl: gitHubUser.avatar_url,
            })
            .returning();
        userId = newUser!.id;
        await database.insert(oauthAccounts).values({
            userId,
            provider,
            providerAccountId,
            accessToken,
        });
    }

    const [user] = await database
        .select({id: users.id, email: users.email, name: users.name, avatarUrl: users.avatarUrl})
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

    const token = signToken(userId);
    return {
        user: user!,
        token,
    };
}

export interface GitHubRepo {
    id: number;
    name: string;
    full_name: string;
    private: boolean;
    html_url: string;
    description: string | null;
    default_branch: string | null;
    created_at: string;
    updated_at: string;
    pushed_at: string;
    owner: {
        login: string;
        id: number;
    };
}

export async function getGitHubRepos(
    accessToken: string,
    page: number = 1,
    perPage: number = 30,
): Promise<GitHubRepo[]> {
    const response = await axios.get<GitHubRepo[]>("https://api.github.com/user/repos", {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
        },
        params: {
            page,
            per_page: perPage,
            sort: "updated",
            direction: "desc",
        },
    });
    return response.data;
}
