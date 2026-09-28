"use client";

import { Plus } from "lucide-react";

import { Logo } from "@/app/components/landing/logo";
import { SidebarSessions } from "@/app/components/console/sidebar-sessions";
import { SidebarUser } from "@/app/components/console/sidebar-user";
import { useGoToConsole } from "@/app/components/console/workspace-context";
import { Button } from "@/app/components/ui/button";

/**
 * Console sidebar content — shared by the desktop rail and the mobile
 * Sheet. Information architecture: identity → new session → sessions →
 * user. Repository selection lives in the composer (`+` / "@"), not here.
 * No V1-unnecessary destinations (automations, security, review, wiki,
 * customize) — only what the backend supports.
 *
 * "New session" navigates to the console workspace; sessions are created
 * by submitting the first prompt (never as empty API calls).
 */
export function ConsoleSidebarContent() {
  const goToConsole = useGoToConsole();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 px-4 pt-4 pb-3">
        <Logo inverse />
        <span className="ml-auto rounded-md border border-border px-1.5 py-0.5 text-[11px] leading-4 text-faint">
          Console
        </span>
      </header>

      <div className="px-3 pb-3">
        <Button type="button" size="lg" onClick={goToConsole} className="w-full justify-start">
          <Plus aria-hidden="true" />
          New session
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        <SidebarSessions />
      </div>

      <SidebarUser />
    </div>
  );
}
