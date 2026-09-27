"use client";

import { useEffect, useState } from "react";

import { ApiError, getMe } from "@/lib/api";

/**
 * The authenticated identity used by the console. The gateway's
 * `GET /api/v1/auth/me` is the single source of truth — the console
 * route param is navigation only and is always verified against this.
 */
export interface CurrentUser {
  id: string;
  email: string;
  name: string | null;
}

export type CurrentUserState =
  | { status: "loading" }
  | { status: "unauthenticated" }
  | { status: "error"; message: string; retry: () => void }
  | { status: "authed"; user: CurrentUser };

/**
 * De-duplicates concurrent `getMe()` calls (guard + workspace provider
 * mount together) and caches a successful identity for the lifetime of
 * the page. Failures are not cached so `retry()` can refetch.
 */
let inflight: Promise<CurrentUser | null> | null = null;

function fetchCurrentUser(): Promise<CurrentUser | null> {
  if (!inflight) {
    inflight = getMe()
      .then((data) => {
        const user = (data as { user?: CurrentUser } | null)?.user;
        if (user && typeof user.id === "string") return user;
        inflight = null;
        return null;
      })
      .catch((err) => {
        inflight = null;
        if (err instanceof ApiError && err.status >= 400 && err.status < 500) return null;
        throw err;
      });
  }
  return inflight;
}

/** Drop the cached identity (used when signing out). */
export function clearCurrentUser() {
  inflight = null;
}

export function useCurrentUser(): CurrentUserState {
  const [state, setState] = useState<CurrentUserState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  // Reset to loading in the retry handler (not in the effect) so the
  // effect only performs the async fetch.
  const retry = () => {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  };

  useEffect(() => {
    let active = true;

    fetchCurrentUser()
      .then((user) => {
        if (!active) return;
        setState(user ? { status: "authed", user } : { status: "unauthenticated" });
      })
      .catch((err: unknown) => {
        if (!active) return;
        setState({
          status: "error",
          message: err instanceof Error ? err.message : "Couldn't reach Klinpi.",
          retry,
        });
      });

    return () => {
      active = false;
    };
  }, [attempt]);

  return state;
}
