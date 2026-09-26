# GitHub OAuth Explained — Klinpi

## Part 1 — OAuth from Absolute Zero

### What is OAuth?

OAuth is a way for you to let someone do something on your behalf, **without giving them your password**.

### Real-world analogy

Imagine you walk into a hotel. The front desk gives you a **room key card**. That card:

- Lets you open **your room** (and only your room)
- Does **NOT** give you the master key to every room
- **Expires** when you check out
- Can be **revoked** by the front desk at any time

You never gave the hotel your house key. You never gave them your car keys. You gave them **permission** for a **specific, limited action** (open room 412), and they gave you a **temporary credential** (the key card) that grants that specific access.

OAuth works exactly the same way. You want Klinpi to access your GitHub repos. You do NOT want to give Klinpi your GitHub password. So GitHub gives Klinpi a temporary "key card" (access token) that lets Klinpi do only what you approved.

### What problem does it solve?

Without OAuth, Klinpi would need your GitHub username and password to access your repos. That is:
- **Dangerous** — Klinpi now has your password. If Klinpi gets hacked, your GitHub account is compromised.
- **Overpowered** — Klinpi can now do anything you can do on GitHub (delete repos, change settings, impersonate you).
- **Inconvenient** — If you change your GitHub password, Klinpi stops working.

OAuth solves all three problems.

---

### Key Terms

### Authentication — "Who are you?"

This is the act of proving your identity. When you type your email and password into GitHub, that is authentication. GitHub says: "OK, you are arav."

### Authorization — "What are you allowed to do?"

This is the act of granting permission. After you prove you are arav, you can say "Klinpi is allowed to read my repos." That is authorization.

### OAuth — The protocol for authorization without passwords

OAuth is the system that lets you give Klinpi limited access to your GitHub account without sharing your password.

### Authorization Code — A temporary voucher

When you approve Klinpi on GitHub, GitHub gives Klinpi a short-lived code (like `abc123`). This code is NOT the access token. It is a voucher that Klinpi can trade in for the real token. The code lives for about 10 minutes and can only be used once.

**Why not just give the access token directly?** Because the authorization code is exchanged server-to-server (backend to GitHub), where the client secret is safe. If GitHub gave the token directly to the browser, anyone could intercept it.

### Access Token — The key card

This is the actual credential that lets Klinpi call GitHub APIs on your behalf. It looks like `gho_xyz789`. It proves "I am acting on behalf of arav, and I have permission to do X, Y, Z."

### Refresh Token — A way to get a new key card

When your key card (access token) expires, the refresh token lets you get a new one without the user having to log in again. **Your implementation does NOT use refresh tokens** — I will explain this later.

### Client ID — The app's public username

When you registered Klinpi as a GitHub OAuth app, GitHub gave you a `client_id`. This is public — it goes in the browser URL. It tells GitHub "this request is coming from Klinpi."

Example: `Ov23liWgHvdoOQGGc2YS`

### Client Secret — The app's password

GitHub also gave you a `client_secret`. This is **secret** — it never goes to the browser. It proves to GitHub "I am really Klinpi, not someone pretending to be Klinpi." It is sent server-to-server during the token exchange.

Example: `5390e4842def80de810e88fc62bcc7f3bbcbe705`

### Redirect URI — Where GitHub sends the user back

After the user approves or denies, GitHub redirects their browser to a specific URL you registered. This is how GitHub gets the authorization code back to Klinpi.

Example: `http://localhost:3100/api/v1/oauth/github/callback`

### Scope — What permission is being asked for

Scopes define what Klinpi is allowed to do. You cannot ask for everything — you must specify what you need. It is like a hotel key card that only opens the gym, not the pool.

---

## Part 2 — GitHub OAuth Specifically

Here is the complete flow with concrete values:

### Step 1: User clicks "Continue with GitHub"

The browser navigates to Klinpi's backend:

```
GET http://localhost:3100/api/v1/oauth/github
```

**Who makes the request:** The browser (user's click).
**What data is sent:** Nothing special — just a GET request.
**Why:** The user wants to log in with GitHub.

### Step 2: Klinpi backend builds the GitHub authorization URL

Klinpi constructs a URL like:

```
https://github.com/login/oauth/authorize
  ?client_id=Ov23liWgHvdoOQGGc2YS
  &scope=repo+user+user:email
  &redirect_uri=http://localhost:3100/api/v1/oauth/github/callback
  &response_type=code
  &state=a1b2c3d4e5f6...random32bytes...
```

**Who makes the request:** Klinpi backend (server-side).
**What data is sent:** The client ID, scopes, redirect URI, and a random state string.
**Why:** GitHub needs to know who is asking (client_id), what permissions are needed (scope), where to send the user back (redirect_uri), and this needs CSRF protection (state).
**What comes back:** A URL that the browser should visit.

### Step 3: Browser redirects to GitHub

```
Browser → https://github.com/login/oauth/authorize?client_id=Ov23li...&scope=repo+user+user:email&...
```

**Who makes the request:** The browser.
**What data is sent:** Everything in the URL (client_id, scopes, etc.).
**Why:** GitHub needs to show the user the consent screen ("Klinpi wants to access your repositories").

### Step 4: User sees GitHub consent screen

GitHub shows: "Klinpi wants to access your repositories, your profile, and your email addresses."

The user clicks "Authorize."

### Step 5: GitHub redirects back to Klinpi

```
Browser → http://localhost:3100/api/v1/oauth/github/callback?code=abc123def456&state=a1b2c3d4e5f6...random32bytes...
```

**Who makes the request:** GitHub redirects the browser.
**What data is sent:** The authorization `code` and the `state` parameter.
**Why:** GitHub is giving Klinpi the code it needs to get the access token.
**Where does it go:** Back to Klinpi's callback endpoint.

### Step 6: Klinpi backend exchanges the code for an access token

```
POST https://github.com/login/oauth/access_token
Body: {
  client_id: "Ov23liWgHvdoOQGGc2YS",
  client_secret: "5390e4842def80de810e88fc62bcc7f3bbcbe705",
  code: "abc123def456"
}
Header: Accept: application/json
```

**Who makes the request:** Klinpi backend (server-to-server).
**What data is sent:** The authorization code, client ID, and client secret.
**Why:** Klinpi is trading the code for the real access token. The client secret proves Klinpi is who it claims to be.
**What comes back:** `{"access_token": "gho_xyz789", "token_type": "bearer", "scope": "repo,user,user:email"}`
**Why only server-side:** The client secret is sent here. If this happened in the browser, anyone could see the secret.

### Step 7: Klinpi fetches GitHub user info

```
GET https://api.github.com/user
Header: Authorization: Bearer gho_xyz789
```

**Who makes the request:** Klinpi backend.
**What data is sent:** The access token as proof of identity.
**What comes back:** `{"id": 12345, "login": "arav", "name": "Arav Menon", "email": "arav@example.com", "avatar_url": "https://..."}`

### Step 8: Klinpi fetches GitHub emails

```
GET https://api.github.com/user/emails
Header: Authorization: Bearer gho_xyz789
```

**Who makes the request:** Klinpi backend.
**What data is sent:** The access token.
**What comes back:** `[{"email": "arav@example.com", "primary": true, "verified": true}, {"email": "arav@users.noreply.github.com", "primary": false, "verified": true}]`
**Why:** Sometimes the user's primary GitHub email is private and not returned by `/user`. This endpoint ensures we get the real email.

### Step 9: Klinpi creates or finds the user

Klinpi looks up the GitHub user ID in `OAuthAccount` table. If found, it updates the access token. If not found, it looks up by email. If still not found, it creates a new user.

### Step 10: Klinpi sets a JWT cookie

Klinpi creates a JWT (JSON Web Token) containing `{sub: "user_id_123"}` and sets it as an httpOnly cookie named `klinpi_token`.

### Step 11: Browser is redirected to frontend

```
Browser → http://localhost:3000
```

The browser now has the `klinpi_token` cookie. Every subsequent request to Klinpi's API includes this cookie. The `authMiddleware` reads it, verifies the JWT, and extracts the user ID.

---

## Part 3 — The Browser Flow in Detail

What happens when you click "Continue with GitHub":

### 1. Frontend button is clicked

Your React/Next.js frontend has a button like "Continue with GitHub." When clicked, it does:

```js
window.location.href = "http://localhost:3100/api/v1/oauth/github"
```

This is a full browser navigation — the page changes.

### 2. Browser goes to Klinpi backend

The browser sends `GET /api/v1/oauth/github` to your Express server.

### 3. Backend creates the GitHub authorization URL

In `oauth.controller.ts`, the `githubLogin` function:
- Generates a random `state` string (`crypto.randomBytes(32).toString("hex")`)
- Calls `oauthService.getLoginUrl("github", state)` which builds the GitHub URL
- Stores the state in an httpOnly cookie (`oauth_state`)
- Returns a `302 Redirect` to the GitHub URL

### 4. Browser goes to GitHub

GitHub shows the consent screen. The user sees:

> "Klinpi wants to access your repositories, your profile, and your email addresses."
>
> [Authorize Klinpi] [Cancel]

### 5. User approves permissions

The user clicks "Authorize."

### 6. GitHub redirects back to Klinpi

GitHub sends the browser to:
```
http://localhost:3100/api/v1/oauth/github/callback?code=abc123...&state=a1b2c3...
```

### 7. Backend receives the code

In `oauth.controller.ts`, the `githubCallback` function:
- Extracts `code` and `state` from the query string
- Reads the `oauth_state` cookie
- Compares them — if they don't match, it rejects the request (CSRF protection)
- Clears the state cookie

### 8. Backend exchanges the code for a token

Calls `oauthService.exchangeCodeForToken("github", code)` which:
- POSTs to `https://github.com/login/oauth/access_token` with `client_id`, `client_secret`, and `code`
- Gets back `{"access_token": "gho_xyz789"}`

### 9. Backend fetches GitHub user information

Calls `oauthService.getGitHubUser(accessToken)` which:
- GETs `https://api.github.com/user` with the access token
- Gets back `{"id": 12345, "login": "arav", "name": "Arav Menon", ...}`

### 10. Backend fetches the email

Calls `oauthService.getGitHubEmails(accessToken)` which:
- GETs `https://api.github.com/user/emails` with the access token
- Gets back `[{"email": "arav@example.com", "primary": true, "verified": true}, ...]`

### 11. Backend creates/finds the Klinpi user

Calls `oauthService.findOrCreateOAuthUser(...)` which:
- Checks if an `OAuthAccount` exists for `[github, 12345]`
  - If yes → updates the access token, signs JWT for existing user
  - If no → checks if a `User` with email `arav@example.com` exists
    - If yes → creates `OAuthAccount` linked to that user, signs JWT
    - If no → creates new `User` + `OAuthAccount`, signs JWT

### 12. Backend sets the JWT cookie

Calls `setAuthCookie(res, token)` which:
- Sets a cookie named `klinpi_token` with the JWT value
- httpOnly (JavaScript cannot read it)
- secure (only sent over HTTPS in production)
- sameSite: lax (protects against CSRF)
- maxAge: 15 minutes

### 13. Backend redirects to frontend

```js
res.redirect(FRONTEND_URL)  // http://localhost:3000
```

### 14. Browser is now logged in

The browser now has the `klinpi_token` cookie. Every request to Klinpi's API includes this cookie automatically. The `authMiddleware` reads it, verifies the JWT, and attaches `req.userId`.

---

## WHY doesn't the frontend directly exchange the code for the access token?

Because the exchange requires the **client secret**. The client secret is like the master key to your GitHub OAuth app. If you put it in the frontend JavaScript, anyone can:
1. Open browser DevTools
2. See the client secret in the network request
3. Impersonate your app

The flow is designed so the authorization code goes through the browser (URL), but the code-to-token exchange happens server-side where the secret is safe.

Additionally, the client secret is sent in Step 6 (`POST /login/oauth/access_token`). If this happened in the browser, the secret would be visible in the browser's network tab.

---

## Part 4 — Scopes

Your GitHub scopes in `provider.ts`:

```ts
scopes: ["repo", "user", "user:email"],
```

### `repo` — Full access to repositories

This gives Klinpi permission to:
- Read your repositories
- Write to your repositories (push code, create branches, create commits)
- Read/write pull requests, issues, etc.

**Does Klinpi need this?** YES. Klinpi is a coding agent that works on your code. It needs to clone repos, read files, create branches, and push changes.

### `user` — Read your GitHub profile

This gives Klinpi permission to read your GitHub profile information (name, avatar, bio, etc.).

**Does Klinpi need this?** PARTIALLY. Klinpi uses it to display your name and avatar. It is not strictly necessary for the coding agent to function, but it improves the UX.

### `user:email` — Read your email addresses

This gives Klinpi permission to read your email addresses from GitHub.

**Does Klinpi need this?** YES. This is critical. When Klinpi creates a user account, it needs your email. GitHub's `/user` endpoint may not return the email if it's set to private. The `/user/emails` endpoint always returns verified emails.

### What you don't have but might want

- `repo:status` — Read commit statuses. Not needed now.
- `read:org` — Read org membership. Not needed unless Klinpi works with organizations.
- `gist` — Create gists. Not needed.

### Why requesting unnecessary scopes is a security problem

If Klinpi asks for `delete_repo` scope, and Klinpi gets hacked, the attacker can delete all your repos. The principle of least privilege says: ask for ONLY what you need. If you only need to read repos, don't ask for write access. Your current scopes are reasonable for a coding agent.

---

## Part 5 — Access Token vs Repository

This is a critical concept.

### The Access Token is a KEY, not a BOX

Think of the access token as a **key card** that opens the door to a building. The key card itself does NOT contain the furniture inside the building. You need to walk through the door first, then look around.

Similarly:
- **Access token** = `gho_xyz789` (the key)
- **Repository** = `arav/klinpi` (the thing behind the door)

The access token does NOT contain your repositories. It is just a credential that proves "I have permission to access this user's repos." To actually GET the repos, you must use the token to call the GitHub API.

### How Klinpi uses the access token

```
1. User logs in via OAuth
2. Klinpi stores the access token: gho_xyz789
3. User clicks "List my repos"
4. Klinpi calls: GET https://api.github.com/user/repos
   Header: Authorization: Bearer gho_xyz789
5. GitHub responds: [{name: "klinpi", full_name: "arav/klinpi", ...}, {name: "other-repo", ...}]
6. Klinpi shows the list to the user
7. User selects "arav/klinpi"
8. Klinpi stores the repository metadata in the Repository table
```

### What repository information we store

In the `Repository` table:
- `provider`: "GITHUB"
- `providerRepoId`: "123456789" (GitHub's internal ID)
- `owner`: "arav"
- `name`: "klinpi"
- `fullName`: "arav/klinpi"
- `cloneUrl`: "https://github.com/arav/klinpi.git"
- `defaultBranch`: "main"

We do NOT store the access token in the Repository table. The token belongs to the OAuthAccount. Different users can have different tokens. A repository can be accessed by different users with different tokens.

### The flow

```
User logs in
  → GitHub access token stored in OAuthAccount
  → User clicks "List repos"
  → Klinpi calls GitHub API with the access token
  → GitHub returns list of repos
  → User selects "arav/klinpi"
  → Klinpi stores repo metadata in Repository table
  → Later: AgentSession is created with repositoryId
  → Agent clones the repo using the access token
  → Agent works on code
```

---

## Part 6 — Database Schema

### The Models and Their Relationships

```
User
├── OAuthAccount (one-to-many)
│   ├── provider: "github"
│   ├── providerAccountId: "12345"
│   ├── accessToken: "gho_xyz789"
│   ├── refreshToken: null (GitHub doesn't use refresh tokens)
│   └── expiresAt: null
├── Repository (one-to-many)
│   ├── provider: "GITHUB"
│   ├── providerRepoId: "987654321"
│   ├── fullName: "arav/klinpi"
│   ├── cloneUrl: "https://github.com/arav/klinpi.git"
│   └── defaultBranch: "main"
└── AgentSession (one-to-many)
    ├── title: "Fix login bug"
    ├── status: ACTIVE
    ├── repository → Repository (optional)
    ├── messages → Message[]
    ├── runs → AgentRun[]
    └── sandboxes → Sandbox[]
```

### User

Represents a person using Klinpi. Has email, name, avatar. The `passwordHash` is nullable — meaning a user can exist without a password (pure OAuth user).

### OAuthAccount

Represents a link between a User and an external provider (GitHub). One user can have multiple OAuth accounts (e.g., one GitHub, one Google in the future).

- `provider`: "github" (which service)
- `providerAccountId`: "12345" (the user's ID on that service)
- `accessToken`: The credential to call that service's API
- `refreshToken`: For services that support token refresh (GitHub does NOT use this in OAuth flow)
- `expiresAt`: When the token expires (GitHub tokens don't expire by default)

The `@@unique([provider, providerAccountId])` constraint means: there can only be one OAuthAccount for a given provider+account combination. You cannot have two GitHub accounts linked to the same GitHub user ID.

### Repository

Represents a specific GitHub repository that a user has selected to work with. This is metadata about the repo, NOT the access token.

### AgentSession

Represents a conversation/workspace where the AI agent works on a repository. Links to a User (who owns it) and optionally to a Repository (what it's working on).

### Why the access token belongs in OAuthAccount, not Repository

The access token belongs to the **user's relationship with GitHub**, not to a specific repository. One access token gives access to ALL of the user's repos. If you stored the token in Repository, you'd be duplicating it across every repo the user selects. And when the token changes (re-login), you'd need to update every row.

---

## Part 7 — Map Concepts to Your Code

Let me trace the complete flow through your actual code files:

### Step 1: Where the OAuth login starts

**File:** `packages/gateway/src/modules/routes/oauth.routes.ts` line 6
```ts
router.get("/github", githubLogin);
```
**Registered at:** `packages/gateway/src/app.ts` line 25
```ts
app.use("/api/v1/oauth", oauthRoutes);
```
**Full URL:** `GET /api/v1/oauth/github`

### Step 2: Where the authorization URL is created

**File:** `packages/gateway/src/modules/controller/oauth.controller.ts` lines 10-27
```ts
export async function githubLogin(_req: Request, res: Response) {
    const state = crypto.randomBytes(32).toString("hex");  // CSRF protection
    const loginUrl = oauthService.getLoginUrl("github", state);  // builds URL
    res.cookie(OAUTH_STATE_COOKIE, state, {...});  // stores state in cookie
    res.redirect(loginUrl);  // sends browser to GitHub
}
```
**Calls:** `oauthService.getLoginUrl("github", state)` in `packages/gateway/src/modules/services/oauth.service.ts` lines 14-36, which builds:
```
https://github.com/login/oauth/authorize?client_id=Ov23li...&scope=repo+user+user:email&redirect_uri=...&state=a1b2c3...
```

### Step 3: Where the user is redirected to GitHub

**File:** `packages/gateway/src/modules/controller/oauth.controller.ts` line 23
```ts
res.redirect(loginUrl);
```
**What happens:** The browser navigates to GitHub's consent screen.

### Step 4: Where the callback endpoint is

**File:** `packages/gateway/src/modules/routes/oauth.routes.ts` line 7
```ts
router.get("/github/callback", githubCallback);
```
**Full URL:** `GET /api/v1/oauth/github/callback`

### Step 5: Where the authorization code is received

**File:** `packages/gateway/src/modules/controller/oauth.controller.ts` lines 32-37
```ts
const { code, state } = req.query as { code?: string; state?: string };
```
**What data enters:** `?code=abc123...&state=a1b2c3...`
**State validation:** Lines 39-52 check the state cookie against the query parameter.

### Step 6: Where the code is exchanged for an access token

**File:** `packages/gateway/src/modules/controller/oauth.controller.ts` line 54
```ts
const accessToken = await oauthService.exchangeCodeForToken("github", code);
```
**Calls:** `packages/gateway/src/modules/services/oauth.service.ts` lines 38-64
**What data enters:** The authorization code
**What data comes out:** The access token string (`gho_xyz789...`)
**What it does:** POSTs to `https://github.com/login/oauth/access_token` with `client_id`, `client_secret`, and `code`.

### Step 7: Where GitHub user information is fetched

**File:** `packages/gateway/src/modules/controller/oauth.controller.ts` lines 56-58
```ts
const [gitHubUser, emails] = await Promise.all([
    oauthService.getGitHubUser(accessToken),
    oauthService.getGitHubEmails(accessToken),
]);
```
**Calls:** `packages/gateway/src/modules/services/oauth.service.ts` lines 81-88
**What data enters:** The access token
**What data comes out:** `{id: 12345, login: "arav", name: "Arav Menon", ...}`

### Step 8: Where the email is fetched

**File:** `packages/gateway/src/modules/services/oauth.service.ts` lines 91-98
```ts
export async function getGitHubEmails(accessToken: string): Promise<GitHubEmail[]> {
    const response = await axios.get<GitHubEmail[]>("https://api.github.com/user/emails", ...);
    return response.data;
}
```
**What data comes out:** `[{email: "arav@example.com", primary: true, verified: true}, ...]`

### Step 9: Where the User record is created/found

**File:** `packages/gateway/src/modules/services/oauth.service.ts` lines 101-191

The `findOrCreateOAuthUser` function has three paths:

1. **OAuthAccount already exists** (line 110-136): User has logged in with GitHub before. Update the access token, sign JWT, return.

2. **User exists by email but no OAuthAccount** (lines 147-162): User signed up with email/password first. Create an OAuthAccount linked to that user. This is the "link" behavior.

3. **Neither exists** (lines 163-179): Create a new User AND a new OAuthAccount in one database operation using Prisma's nested create.

### Step 10: Where OAuthAccount is created/found

**File:** `packages/gateway/src/modules/services/oauth.service.ts` line 110
```ts
const existingAccount = await db.oAuthAccount.findUnique({
    where: {
        provider_providerAccountId: {
            provider,       // "github"
            providerAccountId,  // "12345"
        },
    },
    include: { user: true },
});
```
If not found, created at lines 155 or 169.

### Step 11: Where the token is stored

**File:** `packages/gateway/src/modules/services/oauth.service.ts` lines 121-124 (update) or 155-162 / 169-175 (create)
```ts
data: { accessToken }  // stored in OAuthAccount table
```

### Step 12: Where the application session is created

**File:** `packages/gateway/src/modules/services/oauth.service.ts` lines 126, 186
```ts
const token = signToken(userId);  // creates JWT
```
**Calls:** `packages/gateway/src/lib/jwt.ts` line 19
```ts
export function signToken(userId: string): string {
    const payload: JwtPayload = {sub: userId};
    return jwt.sign(payload, getJwtSecret(), {expiresIn: JWT_EXPIRES_IN});
}
```

### Step 13: How the browser remains authenticated

**File:** `packages/gateway/src/modules/controller/oauth.controller.ts` line 68
```ts
setAuthCookie(res, result.token);
```
**Calls:** `packages/gateway/src/lib/jwt.ts` lines 28-36
```ts
res.cookie("klinpi_token", token, {
    httpOnly: true,        // JavaScript can't read it
    secure: true,          // HTTPS only in production
    sameSite: "lax",       // CSRF protection
    maxAge: 15 * 60 * 1000, // 15 minutes
    path: "/",
});
```
After this, every request from the browser automatically includes the `klinpi_token` cookie. The `authMiddleware` in `packages/gateway/src/middleware/auth.middleware.ts` reads it, verifies the JWT, and sets `req.userId`.

### Step 14: Where repository information is fetched

**File:** `packages/gateway/src/modules/controller/user.controller.ts` lines 129-163
```ts
export async function listRepos(req: AuthenticatedRequest, res: Response) {
    const oauthAccount = await db.oAuthAccount.findFirst({
        where: { userId, provider: "github" },
    });
    const repos = await oauthService.getGitHubRepos(oauthAccount.accessToken, page, perPage);
    res.json({repos});
}
```
**Route:** `GET /api/v1/user/repos` (in `packages/gateway/src/modules/routes/user.routes.ts` line 13)

### Step 15: Where Repository records are created/updated

This part is NOT yet implemented in your codebase. The `listRepos` endpoint returns raw GitHub data. When a user selects a repo, you would create a `Repository` record in the database. This would be a new function in `user.service.ts` or a new `repo.service.ts`.

---

## Part 8 — Follow One Complete Example

Let me walk through the entire flow with a fictional user.

### Before Login

Database state:

```
User:          (empty)
OAuthAccount:  (empty)
Repository:    (empty)
AgentSession:  (empty)
```

### Step 1: User clicks "Continue with GitHub"

The browser goes to `http://localhost:3100/api/v1/oauth/github`.

### Step 2: Backend creates the GitHub URL

`githubLogin` in `oauth.controller.ts`:
- Generates state: `a1b2c3d4e5f6...random64chars...`
- Builds URL: `https://github.com/login/oauth/authorize?client_id=Ov23li...&scope=repo+user+user:email&redirect_uri=http://localhost:3100/api/v1/oauth/github/callback&state=a1b2c3d4...`
- Sets cookie: `oauth_state=a1b2c3d4...` (httpOnly, 10 min expiry)
- Redirects browser to GitHub

### Step 3: User sees GitHub consent screen

GitHub shows:
> **Klinpi** wants to access your repositories, your profile, and your email addresses.
>
> [Authorize Klinpi]

User clicks "Authorize."

### Step 4: GitHub redirects back

Browser goes to:
```
http://localhost:3100/api/v1/oauth/github/callback?code=GITHUB_CODE_XYZ&state=a1b2c3d4...
```

### Step 5: Backend validates state

`githubCallback` in `oauth.controller.ts`:
- Extracts `code=GITHUB_CODE_XYZ` and `state=a1b2c3d4...`
- Reads cookie: `oauth_state=a1b2c3d4...`
- They match. OK, proceed.
- Clears the `oauth_state` cookie.

### Step 6: Token exchange

`exchangeCodeForToken("github", "GITHUB_CODE_XYZ")` in `oauth.service.ts`:
- POSTs to `https://github.com/login/oauth/access_token`:
  ```json
  {
    "client_id": "Ov23liWgHvdoOQGGc2YS",
    "client_secret": "5390e4842def80de810e88fc62bcc7f3bbcbe705",
    "code": "GITHUB_CODE_XYZ"
  }
  ```
- GitHub responds:
  ```json
  {
    "access_token": "gho_ABC123DEF456",
    "token_type": "bearer",
    "scope": "repo,user,user:email"
  }
  ```
- Returns: `"gho_ABC123DEF456"`

### Step 7: Fetch GitHub user info

`getGitHubUser("gho_ABC123DEF456")` in `oauth.service.ts`:
- GETs `https://api.github.com/user` with `Authorization: Bearer gho_ABC123DEF456`
- GitHub responds:
  ```json
  {
    "id": 12345678,
    "login": "arav",
    "name": "Arav Menon",
    "email": null,
    "avatar_url": "https://avatars.githubusercontent.com/u/12345678"
  }
  ```
  (Note: email is null because the user has it set to private on GitHub)

### Step 8: Fetch GitHub emails

`getGitHubEmails("gho_ABC123DEF456")` in `oauth.service.ts`:
- GETs `https://api.github.com/user/emails` with `Authorization: Bearer gho_ABC123DEF456`
- GitHub responds:
  ```json
  [
    {"email": "arav@example.com", "primary": true, "verified": true, "visibility": "public"},
    {"email": "12345678+arav@users.noreply.github.com", "primary": false, "verified": true, "visibility": null}
  ]
  ```

### Step 9: findOrCreateOAuthUser

`findOrCreateOAuthUser("github", gitHubUser, emails, "gho_ABC123DEF456")` in `oauth.service.ts`:

**Check 1:** Does OAuthAccount exist for `[github, "12345678"]`?
-> No. This user has never logged in with GitHub before.

**Check 2:** Does a User exist with email `arav@example.com`?
-> No. This is a brand new user.

**Action:** Create both:

```sql
-- User created
INSERT INTO "User" (id, email, name, "avatarUrl", "createdAt", "updatedAt")
VALUES ('cuid_abc123', 'arav@example.com', 'Arav Menon', 'https://avatars...', now(), now());

-- OAuthAccount created
INSERT INTO "OAuthAccount" (id, "userId", provider, "providerAccountId", "accessToken")
VALUES ('cuid_def456', 'cuid_abc123', 'github', '12345678', 'gho_ABC123DEF456');
```

### Step 10: JWT created and cookie set

```ts
const token = signToken("cuid_abc123");
// token = "eyJhbGciOiJIUzI1NiIs..." (JWT with {sub: "cuid_abc123"}, expires in 15 min)
```

Cookie set: `klinpi_token=eyJhbGciOiJIUzI1NiIs...`

### Step 11: Browser redirected to frontend

```
Browser → http://localhost:3000
```

The `klinpi_token` cookie is now stored in the browser.

### Database state after login:

```
User:
  id: "cuid_abc123"
  email: "arav@example.com"
  name: "Arav Menon"
  avatarUrl: "https://avatars.githubusercontent.com/u/12345678"
  passwordHash: null  (OAuth-only user, no password)

OAuthAccount:
  id: "cuid_def456"
  userId: "cuid_abc123"
  provider: "github"
  providerAccountId: "12345678"
  accessToken: "gho_ABC123DEF456"
  refreshToken: null
  expiresAt: null
```

### Step 12: User lists repos

Browser: `GET /api/v1/user/repos` with cookie `klinpi_token=eyJ...`

`authMiddleware` verifies the JWT, sets `req.userId = "cuid_abc123"`.

`listRepos` in `user.controller.ts`:
1. Finds `OAuthAccount` where `userId = "cuid_abc123"` and `provider = "github"`
2. Gets `accessToken = "gho_ABC123DEF456"`
3. Calls `getGitHubRepos("gho_ABC123DEF456")` -> `GET https://api.github.com/user/repos`
4. Returns:
```json
{
  "repos": [
    {"id": 987654321, "name": "klinpi", "full_name": "arav/klinpi", "clone_url": "https://github.com/arav/klinpi.git", "default_branch": "main", ...},
    {"id": 987654322, "name": "portfolio", "full_name": "arav/portfolio", ...}
  ]
}
```

### Step 13: User selects "arav/klinpi"

(This part is not yet implemented in your code, but here is what SHOULD happen)

1. Backend creates a `Repository` record:
```sql
INSERT INTO "Repository" (id, "userId", provider, "providerRepoId", owner, name, "fullName", "cloneUrl", "defaultBranch")
VALUES ('cuid_repo1', 'cuid_abc123', 'GITHUB', '987654321', 'arav', 'klinpi', 'arav/klinpi', 'https://github.com/arav/klinpi.git', 'main');
```

2. Backend creates an `AgentSession`:
```sql
INSERT INTO "AgentSession" (id, "userId", "repositoryId", title, status)
VALUES ('cuid_session1', 'cuid_abc123', 'cuid_repo1', 'Fix login bug', 'ACTIVE');
```

3. Later, an E2B sandbox is created and the agent clones the repo using the access token.

---

## Part 9 — OAuth Security

### Client Secret

**Status: NEEDS IMPROVEMENT (for production)**

Your `.env` file contains:
```
GITHUB_CLIENT_SECRET="5390e4842def80de810e88fc62bcc7f3bbcbe705"
```

This is committed to git (`.env` is not in `.gitignore` — only `.env.example` is). Your client secret is in your git history. Anyone with access to the repo can see it. For a personal project this is fine. For production, you need environment variables in your deployment platform (Vercel, Railway, etc.), not in git.

### Access Token Storage

**Status: NEEDS IMPROVEMENT**

In `oauth.service.ts` line 123:
```ts
await db.oAuthAccount.update({
    where: { id: existingAccount.id },
    data: { accessToken },  // stored in plain text
});
```

The access token is stored in plain text in PostgreSQL. If your database is compromised, the attacker gets every user's GitHub access token. For production, you should encrypt the access token at rest (e.g., with AES-256) and decrypt it only when needed.

### Refresh Token Storage

**Status: NOT APPLICABLE**

GitHub OAuth tokens do NOT expire by default. They last until the user revokes them. So you don't need refresh tokens. Your `refreshToken` and `expiresAt` fields in `OAuthAccount` exist but are always null. This is correct for GitHub.

### Redirect URI Validation

**Status: SAFE (with caveat)**

Your redirect URI is `http://localhost:3100/api/v1/oauth/github/callback`. This is registered with GitHub, so GitHub will only redirect to this URL. This is correct.

**Caveat:** In production, this must be `https://your-domain.com/api/v1/oauth/github/callback`. If you leave it as `http://localhost:3100` in production, it won't work.

### State Parameter (CSRF Protection)

**Status: SAFE**

Your implementation:
1. Generates a random 32-byte state: `crypto.randomBytes(32).toString("hex")` (line 12 of `oauth.controller.ts`)
2. Stores it in an httpOnly cookie (lines 15-21)
3. Validates it on callback (lines 49-52)

This is correct. An attacker cannot forge the callback because they don't know the state value (it's in an httpOnly cookie they can't read).

### PKCE

**Status: NOT IMPLEMENTED (acceptable for server-side apps)**

PKCE (Proof Key for Code Exchange) is an extension to OAuth that protects against authorization code interception. It is required for public clients (mobile apps, SPAs) but optional for confidential clients (server-side apps like yours). Since your token exchange happens server-side with the client secret, PKCE is not strictly necessary.

### Token Leakage

**Status: SAFE (with same caveat as access token storage)**

Your JWT cookie is httpOnly, so JavaScript cannot read it. Your access token is stored server-side, never sent to the browser. This is correct.

**Same caveat:** The access token in the database is plain text.

### Logging

**Status: NEEDS IMPROVEMENT**

In `oauth.controller.ts` line 25:
```ts
console.error("GitHub login error:", error);
```

And line 72:
```ts
console.error("GitHub callback error:", error);
```

In production, you should be careful about what errors you log. If the error contains the access token or client secret, logging it would be a security issue. Your current code logs the error object, which could contain sensitive data from Axios responses.

### Cookies

**Status: SAFE**

Your cookies:
- `httpOnly: true` — JavaScript cannot read them
- `secure: process.env.NODE_ENV === "production"` — HTTPS only in production
- `sameSite: "lax"` — Protects against CSRF (a malicious site can't make the browser send this cookie in a POST request)
- `maxAge: 15 * 60 * 1000` — 15 minute expiry

These are all correct settings.

### Session Security

**Status: SAFE**

Your JWT expires in 15 minutes. The cookie is httpOnly and sameSite: lax. The `authMiddleware` validates the JWT on every request.

### HTTPS

**Status: SAFE (in production)**

Your cookie has `secure: process.env.NODE_ENV === "production"`, which means it's HTTPS-only in production. This is correct.

### OAuth Callback Validation

**Status: SAFE**

You validate the state parameter on callback (lines 49-52 of `oauth.controller.ts`). You also check that `code` and `state` are present (lines 34-37). You clear the state cookie after validation (lines 42-47). This is all correct.

---

## Part 10 — GitHub Repository Access for Klinpi

### The Complete Product Flow

```
GitHub OAuth
  -> User identity (we know who they are)
  -> GitHub credential (we have their access token)
  -> Repository discovery (we list their repos via API)
  -> User selects repository
  -> Repository metadata stored in PostgreSQL
  -> AgentSession created
  -> E2B sandbox created
  -> Repository cloned inside sandbox (using the access token)
  -> Agent works on code
  -> Agent pushes changes (using the access token)
```

### How the agent gets access to the repository

The agent needs to clone and push to the user's GitHub repo. To do this, it needs the access token. There are two ways to get it:

1. **From PostgreSQL** (your current approach): The access token is stored in `OAuthAccount`. When the agent needs to clone, the backend retrieves the token from the database and passes it to the sandbox.

2. **From the session context**: The access token could be passed to the sandbox as an environment variable or injected into the git config.

### Should the access token be sent to the frontend?

**NO. NEVER.**

The access token gives full access to the user's GitHub account. If it goes to the browser:
- Any XSS vulnerability exposes it
- Browser extensions can read it
- User can copy it and use it elsewhere (not necessarily bad, but breaks the security model)

Your current implementation correctly keeps the token server-side. The `listRepos` endpoint in `user.controller.ts` retrieves the token from the database and uses it to call GitHub's API, then returns only the repo data (not the token).

### Should the access token be sent directly to the agent?

It depends on what "agent" means in your architecture:

- **If the agent runs on your server:** The agent can access PostgreSQL directly and retrieve the token. This is the safest approach.
- **If the agent runs in an E2B sandbox:** The sandbox is isolated, so passing the token as an environment variable is acceptable. But be careful — the token is now in the sandbox's environment. If the sandbox is compromised, the token is exposed.

Your `Sandbox` model has no field for storing the access token. You'll need to decide how the sandbox gets it when it's created.

### What should and should NOT be stored in PostgreSQL

**STORE:**
- `OAuthAccount.accessToken` — The GitHub credential (encrypted in production)
- `Repository` metadata — owner, name, cloneUrl, defaultBranch, etc.
- `AgentSession` — The conversation/workspace record

**DO NOT STORE:**
- GitHub passwords (you don't have them, which is correct)
- The client secret (it's in env vars, which is correct)
- The authorization code (it's used once and discarded, which is correct)

**NEVER EXPOSE TO THE BROWSER:**
- `OAuthAccount.accessToken`
- `GITHUB_CLIENT_SECRET`
- Any internal IDs that could be used for privilege escalation

### Classic OAuth vs GitHub App

Your current implementation uses **GitHub OAuth App** with `repo` scope. This works, but has limitations for production:

**GitHub OAuth App:**
- The token grants access to ALL of the user's repos
- You cannot limit it to specific repos
- If the user has 500 repos, the agent can access all 500
- The token is long-lived (doesn't expire)
- There's no fine-grained permission control

**GitHub App (recommended for production):**
- You can request access to specific repos
- Permissions are granular (read code, write code, manage webhooks, etc.)
- Tokens expire after 1 hour (but you get refresh tokens)
- Users install the app on specific repos, not all repos
- Better for production cloud coding agents

For a production cloud coding agent, a **GitHub App** would be the better architecture. But for an MVP or personal project, your current OAuth approach works fine.

---

## Final Mental Model

```
Browser (User clicks "Continue with GitHub")
  |
Klinpi Backend (generates state, builds GitHub URL, redirects)
  |
GitHub Authorization Screen (user approves)
  |
GitHub Redirect (sends authorization code back to Klinpi)
  |
Klinpi Backend (validates state, receives code)
  |
Token Exchange (code + client_secret -> access_token)
  |
Access Token (gho_ABC123...)
  |
GitHub API (fetch user profile + emails)
  |
PostgreSQL (create/find User + OAuthAccount, store access token)
  |
JWT Cookie (klinpi_token set in browser)
  |
Browser Redirect (back to frontend, now logged in)
  |
Klinpi Frontend (shows "List repos" button)
  |
User clicks "List repos"
  |
Klinpi Backend (reads access token from DB, calls GitHub API)
  |
GitHub API (returns list of repositories)
  |
User selects "arav/klinpi"
  |
PostgreSQL (Repository metadata stored)
  |
AgentSession created
  |
E2B Sandbox (clones repo using access token)
  |
Agent works on code
```
