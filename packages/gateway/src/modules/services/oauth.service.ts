import axios from "axios";
import { OauthProvider, type OauthProviderConfig } from "../../lib/provider.js";
import { prisma } from "../../lib/prisma.js";
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
    const db = prisma();
    const providerAccountId = String(gitHubUser.id);

    const existingAccount = await db.oAuthAccount.findUnique({
        where: {
            provider_providerAccountId: {
                provider,
                providerAccountId,
            },
        },
        include: { user: true },
    });

    if (existingAccount) {
        await db.oAuthAccount.update({
            where: { id: existingAccount.id },
            data: { accessToken },
        });

        const token = signToken(existingAccount.userId);
        return {
            user: {
                id: existingAccount.user.id,
                email: existingAccount.user.email,
                name: existingAccount.user.name,
                avatarUrl: existingAccount.user.avatarUrl,
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

    const existingUser = await db.user.findUnique({
        where: { email: primaryEmail },
    });

    let userId: string;

    if (existingUser) {
        userId = existingUser.id;
        await db.oAuthAccount.create({
            data: {
                userId,
                provider,
                providerAccountId,
                accessToken,
            },
        });
    } else {
        const newUser = await db.user.create({
            data: {
                email: primaryEmail,
                name: gitHubUser.name ?? gitHubUser.login,
                avatarUrl: gitHubUser.avatar_url,
                oauthAccounts: {
                    create: {
                        provider,
                        providerAccountId,
                        accessToken,
                    },
                },
            },
        });
        userId = newUser.id;
    }

    const user = await db.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, name: true, avatarUrl: true },
    });

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
