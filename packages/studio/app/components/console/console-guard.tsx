"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, TriangleAlert } from "lucide-react";

import { consolePath } from "@/lib/api";
import { useCurrentUser } from "@/app/lib/current-user";
import { ConsoleShell } from "@/app/components/console/console-shell";
import { WorkspaceProvider } from "@/app/components/console/workspace-context";

/**
 * Authentication + ownership gate for `/console/[userId]`.
 *
 * The URL segment is navigation identity only: the signed-in user always
 * comes from `GET /api/v1/auth/me` (httpOnly cookie). Mismatched or
 * unauthenticated visits are redirected — the console never trusts the
 * param as proof of identity. Once authorized it renders the console
 * shell around the route's children.
 */
export function ConsoleGuard({
  userId,
  children,
}: {
  userId: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const state = useCurrentUser();

  const authed = state.status === "authed";
  const ownsWorkspace = authed && state.user.id === userId;

  useEffect(() => {
    if (state.status === "unauthenticated") {
      router.replace("/signin");
    } else if (authed && !ownsWorkspace) {
      router.replace(consolePath(state.user.id));
    }
  }, [state, authed, ownsWorkspace, router]);

  if (ownsWorkspace) {
    return (
      <WorkspaceProvider user={state.user}>
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

  if (state.status === "unauthenticated") {
    return (
      <ConsoleStatusShell label="Redirecting to sign in">
        <p className="text-sm text-subtle">Redirecting to sign in…</p>
      </ConsoleStatusShell>
    );
  }

  if (authed && !ownsWorkspace) {
    return (
      <ConsoleStatusShell label="Opening your workspace">
        <p className="text-sm text-subtle">Opening your workspace…</p>
      </ConsoleStatusShell>
    );
  }

  return (
    <ConsoleStatusShell label="Loading workspace">
      <LoaderCircle className="size-5 animate-spin text-faint" aria-hidden="true" />
      <p className="mt-3 text-sm text-subtle">Loading workspace…</p>
    </ConsoleStatusShell>
  );
}

/**
 * Full-screen status shell (loading / redirect / error) shared by the
 * console and session route guards.
 */
export function ConsoleStatusShell({
  label,
  role,
  children,
}: {
  label: string;
  role?: "status" | "alert";
  children: React.ReactNode;
}) {
  return (
    <div
      className="dark-scope flex min-h-svh items-center justify-center bg-background px-6 text-foreground"
      role={role ?? "status"}
      aria-label={label}
    >
      <div className="flex flex-col items-center text-center">{children}</div>
    </div>
  );
}
