const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3100";

export async function apiRequest(path: string, options: RequestInit = {}) {
  const url = `${API_URL}${path}`;
  const response = await fetch(url, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }

  return data;
}

export async function signup(name: string, email: string, password: string) {
  return apiRequest("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({ name, email, password }),
  });
}

export async function signin(email: string, password: string) {
  return apiRequest("/api/auth/signin", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function logout() {
  return apiRequest("/api/auth/logout", {
    method: "POST",
  });
}

export async function getMe() {
  return apiRequest("/api/auth/me");
}
