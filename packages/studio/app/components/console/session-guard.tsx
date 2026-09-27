"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, TriangleAlert } from "lucide-react";

import { ApiError, consolePath, getSession, type Session } from "@/lib/api";
import { useCurrentUser } from "@/app/lib/current-user";
import { ConsoleShell } from "@/app/components/console/console-shell";
import { ConsoleStatusShell } from "@/app/components/console/console-guard";
import { WorkspaceProvider } from "@/app/components/console/workspace-context";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; forId: string; session: Session }
  | { status: "error"; forId: string; message: string }
  | { status: "not-found"; forId: string };

/**
 * Authentication + ownership gate for `/session/[sessionId]`.
 *
 * The session is fetched from the gateway, which enforces
 * `session.userId === authenticatedUser.id` — a forged/foreign session
 * id is a 404 and redirects to the user's own console. Invalid ids never
 * silently create a session. Load results are tagged with the id they
 * were fetched for, so switching sessions never shows stale data.
 */
export function SessionGuard({
  sessionId,
  children,
}: {
  sessionId: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const state = useCurrentUser();
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [version, setVersion] = useState(0);

  const authed = state.status === "authed";
  const userId = authed ? state.user.id : null;

  useEffect(() => {
    if (state.status === "unauthenticated") {
      router.replace("/signin");
    }
  }, [state, router]);

  useEffect(() => {
    if (!userId) return;
    let active = true;

    getSession(sessionId)
      .then((session) => {
        if (!active) return;
        setLoad({ status: "ready", forId: sessionId, session });
      })
      .catch((err: unknown) => {
        if (!active) return;
        if (err instanceof ApiError && err.status === 404) {
          setLoad({ status: "not-found", forId: sessionId });
          return;
        }
        setLoad({
          status: "error",
          forId: sessionId,
          message: err instanceof Error ? err.message : "Couldn't load the session.",
        });
      });

    return () => {
      active = false;
    };
  }, [userId, sessionId, version]);

  // Foreign / unknown session → own console (never a silent create).
  useEffect(() => {
    if (userId && load.status === "not-found" && load.forId === sessionId) {
      router.replace(consolePath(userId));
    }
  }, [userId, load, sessionId, router]);

  const ready =
    load.status === "ready" && load.forId === sessionId ? load.session : null;
  const loadError =
    load.status === "error" && load.forId === sessionId ? load.message : null;

  function retry() {
    setLoad({ status: "loading" });
    setVersion((v) => v + 1);
  }

  if (state.status === "authed" && ready) {
    return (
      <WorkspaceProvider user={state.user} activeSession={ready}>
        <ConsoleShell>{children}</ConsoleShell>
      </WorkspaceProvider>
    );
  }

  if (state.status === "error") {
    return (
      <ConsoleStatusShell label="Workspace unavailable" role="alert">
        <TriangleAlert className="mb-3 size-5 text-faint" aria-hidden="true" />
        <p className="text-sm text-subtle">{state.message}</p>
        <button
          type="button"
          onClick={state.retry}
          className="mt-4 rounded-lg border border-border bg-surface-raised px-3 py-1.5 text-sm text-foreground transition-colors duration-[150ms] hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Try again
        </button>
      </ConsoleStatusShell>
    );
  }

  if (loadError !== null) {
    return (
      <ConsoleStatusShell label="Session unavailable" role="alert">
        <TriangleAlert className="mb-3 size-5 text-faint" aria-hidden="true" />
        <p className="text-sm text-subtle">{loadError}</p>
        <button
          type="button"
          onClick={retry}
          className="mt-4 rounded-lg border border-border bg-surface-raised px-3 py-1.5 text-sm text-foreground transition-colors duration-[150ms] hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Try again
        </button>
      </ConsoleStatusShell>
    );
  }

  if (state.status === "unauthenticated") {
    return (
      <ConsoleStatusShell label="Redirecting to sign in">
        <p className="text-sm text-subtle">Redirecting to sign in…</p>
      </ConsoleStatusShell>
    );
  }

  return (
    <ConsoleStatusShell label="Loading session">
      <LoaderCircle className="size-5 animate-spin text-faint" aria-hidden="true" />
      <p className="mt-3 text-sm text-subtle">Loading session…</p>
    </ConsoleStatusShell>
  );
}
