"use client";

import { Menu } from "lucide-react";

import { ConsoleSidebarContent } from "@/app/components/console/console-sidebar";
import { useWorkspace } from "@/app/components/console/workspace-context";
import { Button } from "@/app/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/app/components/ui/sheet";

/** Compact top bar for <lg viewports — sidebar moves into a Sheet. */
export function ConsoleMobileBar() {
  const { activeSession } = useWorkspace();
  const title = activeSession?.title?.trim() || "Console";

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3 lg:hidden">
      <Sheet>
        <SheetTrigger asChild>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Open navigation">
            <Menu aria-hidden="true" />
          </Button>
        </SheetTrigger>
        <SheetContent
          side="left"
          className="dark-scope w-[264px] max-w-[80vw] border-border bg-surface-raised p-0 text-foreground"
        >
          <SheetTitle className="sr-only">Console navigation</SheetTitle>
          <ConsoleSidebarContent />
        </SheetContent>
      </Sheet>
      <span className="truncate text-[13px] font-medium text-foreground">{title}</span>
    </header>
  );
}
