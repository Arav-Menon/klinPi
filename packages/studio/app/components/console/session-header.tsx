"use client";

import type { ReactNode } from "react";
import { FolderGit2 } from "lucide-react";

import { useWorkspace } from "@/app/components/console/workspace-context";
import type { SocketStatus } from "@/app/lib/ws";
import { Badge } from "@/app/components/ui/badge";
import { cn } from "cn";

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Active",
  PAUSED: "Paused",
  COMPLETED: "Completed",
  FAILED: "Failed",
  ARCHIVED: "Archived",
};

const STATUS_DOT: Record<string, string> = {
  ACTIVE: "bg-success",
  PAUSED: "bg-warning",
  COMPLETED: "bg-faint",
  FAILED: "bg-danger",
  ARCHIVED: "bg-faint",
};

const CONNECTION: Record<SocketStatus, { label: string; dot: string }> = {
  connecting: { label: "Connecting…", dot: "bg-warning" },
  connected: { label: "Live", dot: "bg-success" },
  reconnecting: { label: "Reconnecting…", dot: "bg-warning" },
  error: { label: "Offline", dot: "bg-danger" },
};

/**
 * Workspace header: current session identity + repository context.
 * Shows only real data from the workspace context (active session /
 * selected GitHub repository) — no placeholder repo names. The optional
 * `connection` slot surfaces the session WebSocket state; `toolsSlot`
 * renders trailing header actions (e.g. the workspace "+" menu).
 */
export function SessionHeader({
  connection,
  toolsSlot,
}: {
  connection?: SocketStatus;
  toolsSlot?: ReactNode;
}) {
  const { activeSession, selectedRepo, repos } = useWorkspace();

  const title = activeSession
    ? activeSession.title || "Untitled session"
    : "New session";

  const conn = connection ? CONNECTION[connection] : null;

  // Session pages show the repository the session is linked to (resolved
  // against the synced repo list); the console shows the pending selection.
  const linkedRepo = activeSession?.repositoryId
    ? (repos.find((r) => r.repositoryId === activeSession.repositoryId) ?? null)
    : null;
  const shownRepo = activeSession ? linkedRepo : selectedRepo;

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
      <h1 className="min-w-0 truncate text-sm font-medium text-foreground">{title}</h1>

      {activeSession ? (
        <Badge variant="outline" className="hidden shrink-0 gap-1.5 border-border text-faint sm:inline-flex">
          <span
            aria-hidden="true"
            className={cn(
              "size-1.5 rounded-full",
              STATUS_DOT[activeSession.status] ?? "bg-faint",
            )}
          />
          {STATUS_LABEL[activeSession.status] ?? activeSession.status}
        </Badge>
      ) : null}

      <div className="ml-auto flex min-w-0 items-center gap-2">
        {conn ? (
          <span
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface-raised px-2.5 py-1 text-xs text-subtle"
            data-connection-state={connection}
            role="status"
          >
            <span aria-hidden="true" className={cn("size-1.5 rounded-full", conn.dot)} />
            {conn.label}
          </span>
        ) : null}

        {shownRepo ? (
          <span
            className="flex min-w-0 items-center gap-1.5 rounded-full border border-border bg-surface-raised px-2.5 py-1 text-xs text-subtle"
            title={shownRepo.html_url}
          >
            <FolderGit2 className="size-3.5 shrink-0 text-faint" aria-hidden="true" />
            <span className="truncate">{shownRepo.full_name}</span>
          </span>
        ) : activeSession?.repositoryId ? (
          <span
            className="flex min-w-0 items-center gap-1.5 rounded-full border border-border bg-surface-raised px-2.5 py-1 text-xs text-subtle"
            title={activeSession.repositoryId}
          >
            <FolderGit2 className="size-3.5 shrink-0 text-faint" aria-hidden="true" />
            <span className="truncate">Repository linked</span>
          </span>
        ) : (
          <span className="hidden items-center gap-1.5 text-xs text-faint sm:flex">
            <FolderGit2 className="size-3.5" aria-hidden="true" />
            No repository selected
          </span>
        )}

        {toolsSlot}
      </div>
    </header>
  );
}
