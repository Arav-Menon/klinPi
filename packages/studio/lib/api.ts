const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3100";

function errorMessage(body: unknown): string {
  if (body && typeof body === "object" && "error" in body) {
    const error = (body as { error: unknown }).error;
    if (typeof error === "string" && error.length > 0) return error;
  }
  return "Request failed";
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
    throw new Error(errorMessage(data));
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

/**
 * GitHub OAuth starts with a full-page navigation (not a fetch) so the
 * gateway can set the `oauth_state` cookie and 302-redirect to GitHub.
 */
export function githubAuthUrl() {
  return `${API_URL}/api/v1/oauth/github`;
}
