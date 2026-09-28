const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3100";

function errorMessage(body: unknown): string {
  if (body && typeof body === "object" && "error" in body) {
    const error = (body as { error: unknown }).error;
    if (typeof error === "string" && error.length > 0) return error;
  }
  return "Request failed";
}

/**
 * Error thrown by `apiRequest`. Extends `Error` so existing
 * `err instanceof Error ? err.message` handling keeps working,
 * while carrying the HTTP status for callers that need it
 * (e.g. treating 404 from /user/repos as "GitHub not connected").
 */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function apiRequest(path: string, options: RequestInit = {}) {
  const url = `${API_URL}${path}`;

  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
  } catch {
    throw new Error("Can't reach the server. Check your connection and try again.");
  }

  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    // Non-JSON body (e.g. a proxy/gateway error page) — fall through.
  }

  if (!response.ok) {
    throw new ApiError(errorMessage(data), response.status);
  }

  return data;
}

export async function signup(name: string, email: string, password: string) {
  return apiRequest("/api/v1/auth/signup", {
    method: "POST",
    body: JSON.stringify({ name, email, password }),
  });
}

export async function signin(email: string, password: string) {
  return apiRequest("/api/v1/auth/signin", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function logout() {
  return apiRequest("/api/v1/auth/logout", {
    method: "POST",
  });
}

export async function getMe() {
  return apiRequest("/api/v1/auth/me");
}

/** The signed-in user's personal console path, e.g. `/console/<id>/`. */
export function consolePath(userId: string) {
  return `/console/${encodeURIComponent(userId)}/`;
}

/** Session detail route, e.g. `/session/<sessionId>`. */
export function sessionPath(sessionId: string) {
  return `/session/${encodeURIComponent(sessionId)}`;
}

/**
 * Resolve the console path for the current session without assuming the
 * response of a previous call. Used as a fallback when an auth response
 * does not carry the user id — returns "/" if identity is unavailable so
 * the caller never navigates into a broken console URL.
 */
export async function getConsolePath(): Promise<string> {
  try {
    const data = (await getMe()) as { user?: { id?: string } } | null;
    const id = data?.user?.id;
    if (id) return consolePath(id);
  } catch {
    // Unauthenticated or unreachable — fall through.
  }
  return "/";
}

/**
 * GitHub OAuth starts with a full-page navigation (not a fetch) so the
 * gateway can set the `oauth_state` cookie and 302-redirect to GitHub.
 */
export function githubAuthUrl() {
  return `${API_URL}/api/v1/oauth/github`;
}

/* ------------------------------------------------------------------ */
/* Session / repository types — mirror the gateway response contract   */
/* (packages/gateway session.service.ts `SessionResponse`).            */
/* ------------------------------------------------------------------ */

export type SessionStatus = "ACTIVE" | "PAUSED" | "COMPLETED" | "FAILED" | "ARCHIVED";

export interface Session {
  id: string;
  userId: string;
  repositoryId: string | null;
  title: string | null;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface SessionListResponse {
  sessions: Session[];
  nextCursor?: string;
}

/** Persisted conversation message (`Message` table contract). */
export type MessageRole = "USER" | "ASSISTANT" | "SYSTEM" | "TOOL";

export interface SessionMessage {
  id: string;
  role: MessageRole;
  content: string;
  metadata: unknown;
  createdAt: string;
}

/** Minimal slice of GitHub's repo payload the console renders. */
export interface GithubRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
  default_branch: string | null;
  owner: { login: string; id: number };
  /** DB `Repository` row id — sent as `repositoryId` when creating a session. */
  repositoryId?: string | null;
}

export async function listRecentSessions(limit = 20): Promise<SessionListResponse> {
  const data = (await apiRequest(
    `/api/v1/sessions/recent?limit=${encodeURIComponent(limit)}`,
  )) as SessionListResponse;
  return { sessions: data.sessions ?? [], nextCursor: data.nextCursor };
}

export async function searchSessions(query: string, limit = 20): Promise<Session[]> {
  const data = (await apiRequest(
    `/api/v1/sessions/search?q=${encodeURIComponent(query)}&limit=${encodeURIComponent(limit)}`,
  )) as { sessions?: Session[] };
  return data.sessions ?? [];
}

export async function createSession(body: {
  title?: string;
  repositoryId?: string;
  prompt?: string;
}): Promise<Session> {
  const data = (await apiRequest("/api/v1/sessions", {
    method: "POST",
    body: JSON.stringify(body),
  })) as { session: Session };
  return data.session;
}

/**
 * Fetch a single session. 404 means "not found or not yours" — the
 * gateway enforces `session.userId === authenticatedUser.id`.
 */
export async function getSession(sessionId: string): Promise<Session> {
  const data = (await apiRequest(
    `/api/v1/sessions/${encodeURIComponent(sessionId)}`,
  )) as { session: Session };
  return data.session;
}

/**
 * Patch a session. Used to bind a repository to a session that has none
 * (`{ repositoryId }`) or rename it. The gateway enforces one-repository-
 * per-session: a second binding responds with 409.
 */
export async function patchSession(
  sessionId: string,
  body: { title?: string; status?: SessionStatus; repositoryId?: string },
): Promise<Session> {
  const data = (await apiRequest(`/api/v1/sessions/${encodeURIComponent(sessionId)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  })) as { session: Session };
  return data.session;
}

/** Persisted message history for a session, oldest first. */
export async function getSessionMessages(
  sessionId: string,
  limit = 200,
): Promise<SessionMessage[]> {
  const data = (await apiRequest(
    `/api/v1/sessions/${encodeURIComponent(sessionId)}/messages?limit=${encodeURIComponent(limit)}`,
  )) as { messages?: SessionMessage[] };
  return data.messages ?? [];
}

/**
 * Short-lived JWT for the realtime WebSocket (`?token=` query auth).
 * The session cookie is httpOnly, so the browser mints a connectable
 * token through this endpoint on every WS (re)connect.
 */
export async function getWsToken(): Promise<string> {
  const data = (await apiRequest("/api/v1/auth/ws-token")) as { token?: string };
  if (!data?.token) throw new Error("Couldn't get a realtime token.");
  return data.token;
}

/**
 * Live GitHub repositories for the signed-in user (proxied by the gateway).
 * 404 means no GitHub account is connected yet — surfaced as
 * `{ connected: false }` so the sidebar can show a "Connect GitHub" state
 * instead of a generic error.
 */
export async function listGithubRepos(): Promise<
  { connected: true; repos: GithubRepo[] } | { connected: false }
> {
  try {
    const data = (await apiRequest("/api/v1/user/repos")) as { repos?: GithubRepo[] };
    return { connected: true, repos: data.repos ?? [] };
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return { connected: false };
    throw err;
  }
}
