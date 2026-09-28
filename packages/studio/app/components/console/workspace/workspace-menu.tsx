"use client";

import { useState } from "react";
import { Popover } from "radix-ui";
import { ChevronRight, Files, Monitor, Plus } from "lucide-react";

import { cn } from "cn";

/**
 * The session header's "+" workspace control (mirrors the composer's
 * repository "+" button: same trigger styling, radix Popover). Opens a
 * compact menu: "Files" toggles the workspace panel; "Computer" is an
 * `aria-disabled` future entry ("Coming soon") with no behavior wired.
 */
export function WorkspaceMenuButton({ onOpenFiles }: { onOpenFiles: () => void }) {
  const [open, setOpen] = useState(false);

  const itemClass =
    "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors duration-[150ms] outline-none focus-visible:ring-2 focus-visible:ring-ring/60";

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label="Add workspace panel"
          title="Add workspace panel"
          className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-border text-faint transition-colors duration-[150ms] outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <Plus className="size-4" aria-hidden="true" />
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="end"
          sideOffset={8}
          collisionPadding={12}
          // Portals to <body>, outside the console's dark-scope wrapper —
          // re-apply it so the menu matches the dark workspace.
          className="dark-scope w-56 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-lg outline-none"
        >
          <div role="menu" aria-label="Workspace panels" className="p-1">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onOpenFiles();
              }}
              className={cn(itemClass, "text-foreground hover:bg-accent")}
            >
              <Files className="size-3.5 shrink-0 text-faint" aria-hidden="true" />
              Files
              <ChevronRight className="ml-auto size-3.5 text-faint" aria-hidden="true" />
            </button>
            <button
              type="button"
              role="menuitem"
              aria-disabled="true"
              className={cn(itemClass, "cursor-not-allowed text-faint hover:bg-transparent")}
            >
              <Monitor className="size-3.5 shrink-0" aria-hidden="true" />
              Computer
              <span className="ml-auto shrink-0 rounded-full border border-border px-1.5 py-px text-[10px] font-medium">
                Coming soon
              </span>
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
