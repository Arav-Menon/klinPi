"use client";

import { useCallback, useMemo, useState } from "react";
import { FolderTree, RefreshCw, Search, WifiOff, X } from "lucide-react";

import {
  filterFileTree,
  useWorkspaceFileTree,
  workspaceDataSource,
  type WorkspaceFileMatch,
  type WorkspaceFileNode,
} from "@/app/lib/workspace-files";
import { useWorkspaceContent } from "@/app/lib/workspace-content";
import {
  useWorkspaceBusListener,
  type WorkspaceBusMessage,
} from "@/app/lib/workspace-events";
import { FileTree, FileGlyph } from "@/app/components/console/workspace/file-tree";
import { FileContent } from "@/app/components/console/workspace/file-content";
import { RecentFiles } from "@/app/components/console/workspace/recent-files";
import { Input } from "@/app/components/ui/input";
import { cn } from "cn";

const MAX_RECENT = 5;

function fileById(entries: WorkspaceFileNode[], id: string): WorkspaceFileNode | null {
  for (const node of entries) {
    if (node.id === id) return node.kind === "file" ? node : null;
    if (node.children) {
      const hit = fileById(node.children, id);
      if (hit) return hit;
    }
  }
  return null;
}

const MATCH_ROW_CLASS =
  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors duration-[150ms] outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-0";

function MatchRow({ match, selected, onSelect }: {
  match: WorkspaceFileMatch;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      aria-current={selected ? "true" : undefined}
      onClick={() => onSelect(match.node.id)}
      title={match.path ? `${match.path}/${match.node.name}` : match.node.name}
      className={cn(
        MATCH_ROW_CLASS,
        selected ? "bg-accent text-foreground" : "text-subtle hover:bg-accent/60 hover:text-foreground",
      )}
    >
      <FileGlyph name={match.node.name} className={selected ? "text-foreground" : "text-faint"} />
      <span className="min-w-0 truncate">{match.node.name}</span>
      {match.path ? (
        <span className="ml-auto min-w-0 max-w-[55%] shrink truncate text-[11px] text-faint">
          {match.path}
        </span>
      ) : null}
    </button>
  );
}

/**
 * Workspace "Files" view: pinned filter, independent scroll region for
 * the tree, a read-only content pane for the selected file, and the
 * recent-files list.
 *
 * Data comes from the real sandbox filesystem via the gateway tree/file
 * endpoints; live changes arrive as `WORKSPACE_EVENT` frames on the
 * session socket (forwarded through the workspace bus). Incremental
 * events update the tree in place; anything that cannot be applied
 * safely falls back to a full tree resync.
 */
export function FilesView({ sessionId }: { sessionId: string }) {
  const { status, tree, error, reload, applyEvent } = useWorkspaceFileTree(
    workspaceDataSource,
    sessionId,
  );
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [contentRefreshKey, setContentRefreshKey] = useState(0);
  const [connection, setConnection] = useState<
    "connecting" | "connected" | "reconnecting" | "error"
  >("connected");

  // Relative path of the selected file (`Frontend/src/App.jsx`).
  const selectedPath = selectedId ? selectedId.replace(/^\//, "") : null;
  const content = useWorkspaceContent(sessionId, selectedPath, contentRefreshKey);

  const matches = useMemo(
    () => (tree && query.trim() ? filterFileTree(tree, query) : []),
    [tree, query],
  );

  const recentFiles = useMemo(() => {
    if (!tree) return [];
    return recentIds
      .map((id) => fileById(tree.entries, id))
      .filter((node): node is WorkspaceFileNode => node !== null);
  }, [recentIds, tree]);

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id);
    setRecentIds((prev) => [id, ...prev.filter((x) => x !== id)].slice(0, MAX_RECENT));
  }, []);

  const handleDeselect = useCallback(() => {
    setSelectedId(null);
  }, []);

  /** Apply an incremental fs event; fall back to a full resync. */
  const handleFsEvent = useCallback(
    (event: { type: string; path?: string; oldPath?: string; newPath?: string }) => {
      if (event.type === "workspace.tree.resync_required" || event.type === "workspace.ready") {
        reload();
        return;
      }
      if (!applyEvent(event)) {
        reload();
        return;
      }
      // Keep selection / recents in sync with the applied event.
      if (event.type === "workspace.file.deleted" && event.path) {
        const deletedId = `/${event.path}`;
        if (selectedId === deletedId) {
          // Refetch → the content pane shows the "file no longer exists" state.
          setContentRefreshKey((k) => k + 1);
        }
        setRecentIds((prev) => prev.filter((id) => id !== deletedId));
        return;
      }
      if (event.type === "workspace.file.renamed" && event.oldPath && event.newPath) {
        const oldId = `/${event.oldPath}`;
        const newId = `/${event.newPath}`;
        if (selectedId === oldId) setSelectedId(newId);
        setRecentIds((prev) => prev.map((id) => (id === oldId ? newId : id)));
        return;
      }
      if (event.type === "workspace.file.updated" && event.path && event.path === selectedPath) {
        setContentRefreshKey((k) => k + 1);
      }
    },
    [applyEvent, reload, selectedId, selectedPath],
  );

  const busHandler = useCallback(
    (message: WorkspaceBusMessage) => {
      if (message.kind === "fs_event") {
        handleFsEvent(message.event);
        return;
      }
      if (message.kind === "connection") {
        setConnection(message.status);
        return;
      }
      if (message.kind === "reconnected") {
        // Missed events can't be replayed — re-snapshot the tree.
        reload();
        if (selectedPath) setContentRefreshKey((k) => k + 1);
      }
    },
    [handleFsEvent, reload, selectedPath],
  );

  useWorkspaceBusListener(sessionId, busHandler);

  const showConnectionNote = connection === "reconnecting" || connection === "error";

  if (status === "loading") {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <ul
          className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3 animate-pulse-soft"
          aria-hidden="true"
        >
          {[86, 72, 64, 78, 58, 70, 52, 66].map((w, i) => (
            <li key={i} className="h-6 rounded-md bg-white/[0.06]" style={{ width: `${w}%` }} />
          ))}
        </ul>
        <span className="sr-only" role="status">
          Loading workspace files…
        </span>
      </div>
    );
  }

  if (status === "not_ready") {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
        <FolderTree className="mb-3 size-5 text-faint" aria-hidden="true" />
        <p className="text-[13px] text-subtle">Workspace not ready yet.</p>
        <p className="mt-1 text-[11px] leading-4 text-faint">
          The sandbox starts when the agent runs — files will appear here shortly.
          Checking again…
        </p>
        <button
          type="button"
          onClick={reload}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-[13px] text-foreground transition-colors duration-[150ms] hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60 outline-none"
        >
          <RefreshCw className="size-3.5" aria-hidden="true" /> Check again
        </button>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center" role="alert">
        <p className="text-[13px] text-subtle">{error}</p>
        <button
          type="button"
          onClick={reload}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-[13px] text-foreground transition-colors duration-[150ms] hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60 outline-none"
        >
          <RefreshCw className="size-3.5" aria-hidden="true" /> Retry
        </button>
      </div>
    );
  }

  if (!tree || tree.entries.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
        <FolderTree className="mb-3 size-5 text-faint" aria-hidden="true" />
        <p className="text-[13px] text-subtle">No files in this workspace yet.</p>
        <p className="mt-1 text-[11px] leading-4 text-faint">
          Files appear here once the sandbox workspace is ready.
        </p>
      </div>
    );
  }

  const filtering = query.trim().length > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Pinned filter — stays put while the tree scrolls below it. */}
      <div className="shrink-0 border-b border-border px-3 py-2">
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint"
            aria-hidden="true"
          />
          <Input
            id="workspace-file-filter"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter files…"
            aria-label="Filter files"
            autoComplete="off"
            className="h-8 pr-8 pl-8 text-[13px]"
          />
          {filtering ? (
            <button
              type="button"
              aria-label="Clear filter"
              onClick={() => setQuery("")}
              className="absolute top-1/2 right-1.5 flex size-5 -translate-y-1/2 items-center justify-center rounded text-faint transition-colors duration-[150ms] hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-0 outline-none"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>

      {showConnectionNote ? (
        <p
          role="status"
          className="flex shrink-0 items-center gap-1.5 border-b border-border px-3 py-1.5 text-[11px] text-faint"
        >
          <WifiOff className="size-3.5 shrink-0" aria-hidden="true" />
          Realtime disconnected — reconnecting… files may be out of date.
        </p>
      ) : null}

      {/* Tree (flex-1) + optional content pane (split below). */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2">
          {filtering ? (
            matches.length > 0 ? (
              <ul aria-label="File matches">
                {matches.map((match) => (
                  <li key={match.node.id}>
                    <MatchRow
                      match={match}
                      selected={match.node.id === selectedId}
                      onSelect={handleSelect}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-2 py-3 text-[13px] text-faint">No files match “{query.trim()}”.</p>
            )
          ) : (
            <>
              <h3 className="flex items-center gap-1.5 px-2 pb-1.5 font-medium text-faint">
                <FolderTree className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="min-w-0 truncate text-[11px] tracking-wide">{tree.rootName}</span>
                <button
                  type="button"
                  aria-label="Refresh file tree"
                  onClick={reload}
                  className="ml-auto flex size-5 shrink-0 items-center justify-center rounded text-faint transition-colors duration-[150ms] hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-0 outline-none"
                >
                  <RefreshCw className="size-3" aria-hidden="true" />
                </button>
              </h3>
              {tree.truncated ? (
                <p className="px-2 pb-1.5 text-[11px] leading-4 text-faint">
                  Large workspace — showing a partial tree.
                </p>
              ) : null}
              <FileTree tree={tree} selectedId={selectedId} onSelect={handleSelect} />
              <RecentFiles files={recentFiles} selectedId={selectedId} onSelect={handleSelect} />
            </>
          )}
        </div>

        {selectedPath ? (
          <FileContent
            path={selectedPath}
            state={content.state}
            onClose={handleDeselect}
            onRetry={() => setContentRefreshKey((k) => k + 1)}
          />
        ) : null}
      </div>
    </div>
  );
}
