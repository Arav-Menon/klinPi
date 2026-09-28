"use client";

import { Files, Monitor, X } from "lucide-react";

import { FilesView } from "@/app/components/console/workspace/files-view";
import { cn } from "cn";

/**
 * Right-side workspace panel (session page only).
 *
 * - Header: "Workspace" label + close control.
 * - Tabs: "Files" (active, hosts the file explorer) and "Computer"
 *   (`aria-disabled` + "Coming soon" — no sandbox/browser wiring yet).
 * - Body: `FilesView`, which owns its own scroll region.
 *
 * Rendered inline at ≥1024px by `SessionWorkspace`, or inside the
 * right-side `Sheet` drawer below 1024px (same component both ways).
 */

function tabClass(active: boolean, disabled = false): string {
  return cn(
    "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] transition-colors duration-[150ms] outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
    active
      ? "bg-accent text-foreground"
      : "text-subtle hover:bg-accent/50 hover:text-foreground",
    disabled && "cursor-not-allowed text-faint hover:bg-transparent hover:text-faint",
  );
}

interface WorkspacePanelProps {
  sessionId: string;
  onClose: () => void;
  className?: string;
}

export function WorkspacePanel({ sessionId, onClose, className }: WorkspacePanelProps) {
  return (
    <aside
      aria-label="Workspace"
      data-testid="workspace-panel"
      className={cn("flex min-h-0 min-w-0 flex-col border-l border-border bg-background", className)}
    >
      {/* Header */}
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
        <h2 className="text-[11px] font-medium tracking-wide text-faint uppercase">Workspace</h2>
        <button
          type="button"
          aria-label="Close workspace panel"
          title="Close workspace panel"
          onClick={onClose}
          className="ml-auto flex size-6 items-center justify-center rounded-md text-faint transition-colors duration-[150ms] outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      </div>

      {/* Tabs */}
      <div
        role="tablist"
        aria-label="Workspace views"
        className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-2"
      >
        <button
          type="button"
          role="tab"
          id="workspace-tab-files"
          aria-selected="true"
          aria-controls="workspace-tab-panel"
          className={tabClass(true)}
        >
          <Files className="size-3.5 shrink-0" aria-hidden="true" />
          Files
        </button>
        <button
          type="button"
          role="tab"
          id="workspace-tab-computer"
          aria-selected="false"
          aria-disabled="true"
          aria-describedby="workspace-tab-computer-soon"
          className={tabClass(false, true)}
        >
          <Monitor className="size-3.5 shrink-0" aria-hidden="true" />
          Computer
          <span
            id="workspace-tab-computer-soon"
            className="rounded-full border border-border px-1.5 py-px text-[10px] font-medium"
          >
            Coming soon
          </span>
        </button>
      </div>

      {/* Body */}
      <div
        role="tabpanel"
        id="workspace-tab-panel"
        aria-labelledby="workspace-tab-files"
        className="flex min-h-0 flex-1 flex-col"
      >
        <FilesView sessionId={sessionId} />
      </div>
    </aside>
  );
}
