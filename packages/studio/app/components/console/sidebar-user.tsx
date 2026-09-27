"use client";

import { LogOut } from "lucide-react";

import { clearCurrentUser } from "@/app/lib/current-user";
import { useWorkspace } from "@/app/components/console/workspace-context";
import { logout } from "@/lib/api";

function initials(user: { name: string | null; email: string }) {
  const source = (user.name ?? user.email).trim();
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "?";
  const second = parts.length > 1 ? (parts[1]?.[0] ?? "") : "";
  return (first + second).toUpperCase();
}

/**
 * Signed-in identity + sign out. The console shows only what the auth
 * API actually returns (name, email) — no invented profile data.
 */
export function SidebarUser() {
  const { user } = useWorkspace();

  async function handleSignOut() {
    clearCurrentUser();
    try {
      await logout();
    } finally {
      window.location.assign("/signin");
    }
  }

  return (
    <div className="border-t border-border px-3 py-3">
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-[11px] font-semibold text-secondary-foreground"
        >
          {initials(user)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] leading-4 font-medium text-foreground">
            {user.name || user.email}
          </span>
          {user.name ? (
            <span className="block truncate text-[11px] leading-4 text-faint">{user.email}</span>
          ) : null}
        </span>
        <button
          type="button"
          onClick={() => void handleSignOut()}
          aria-label="Sign out"
          title="Sign out"
          className="size-7 shrink-0 rounded-lg text-faint transition-colors duration-[150ms] hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
        >
          <LogOut className="mx-auto size-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
