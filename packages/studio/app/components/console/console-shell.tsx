"use client";

import type { ReactNode } from "react";

import { ConsoleMobileBar } from "@/app/components/console/console-mobile-bar";
import { ConsoleSidebarContent } from "@/app/components/console/console-sidebar";

/**
 * Full-height dark workspace frame: fixed sidebar (desktop) / Sheet
 * (mobile) + main column. `.dark-scope` re-maps every semantic token to
 * the dark palette, so all children use the same token names as the
 * light product surfaces.
 */
export function ConsoleShell({ children }: { children: ReactNode }) {
  return (
    <div className="dark-scope flex h-dvh w-full overflow-hidden overscroll-none bg-background text-foreground">
      <aside className="hidden w-[264px] shrink-0 border-r border-border bg-surface-raised lg:flex lg:flex-col">
        <ConsoleSidebarContent />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <ConsoleMobileBar />
        <main id="main" className="flex min-h-0 flex-1 flex-col">
          {children}
        </main>
      </div>
    </div>
  );
}
