import { GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, GITHUB_REDIRECT_URL } from "@klinpi/common";

export interface OauthProviderConfig {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    authUrl: string;
    tokenUrl: string;
    scopes: string[];
    responseType: string;
    accessType?: string;
    prompt?: string;
}

export const OauthProvider: Record<string, OauthProviderConfig> = {
    github: {
        clientId: GITHUB_CLIENT_ID,
        clientSecret: GITHUB_CLIENT_SECRET,
        redirectUri: GITHUB_REDIRECT_URL,
        authUrl: "https://github.com/login/oauth/authorize",
        tokenUrl: "https://github.com/login/oauth/access_token",
        scopes: ["repo", "user", "user:email"],
        responseType: "code",
    }
}
