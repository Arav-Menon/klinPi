"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  getWorkspaceTree,
  WorkspaceNotReadyError,
  type WorkspaceNodeDto,
} from "@/lib/api";

/**
 * Workspace file-data boundary.
 *
 * The workspace UI (file explorer, recent files, content pane) consumes
 * file trees ONLY through `WorkspaceDataSource` — components never see
 * transport details. The data source below talks to the gateway
 * (`GET /api/v1/sessions/:id/workspace/tree`), which reads the real
 * sandbox filesystem through the runtime. Live updates arrive as
 * `WORKSPACE_EVENT` frames (`app/lib/workspace-events.ts`) and are
 * applied via `applyWorkspaceEvent` — with a tree resync fallback.
 */

export type WorkspaceFileKind = "file" | "folder";

export interface WorkspaceFileNode {
  /** Stable id: the entry's path inside the tree (`/Frontend/src/App.jsx`). */
  id: string;
  name: string;
  kind: WorkspaceFileKind;
  /** Byte size — files only (0 for folders). */
  size?: number;
  /** Child entries — present on folders only. */
  children?: WorkspaceFileNode[];
}

export interface WorkspaceFileTree {
  /** Root folder name, shown as the explorer heading (e.g. `klinpi`). */
  rootName: string;
  entries: WorkspaceFileNode[];
  /** True when the backend truncated the scan — the tree is partial. */
  truncated?: boolean;
}

export interface WorkspaceDataSource {
  /** Load the file tree for a session's workspace. */
  loadFiles(sessionId: string, options?: { signal?: AbortSignal }): Promise<WorkspaceFileTree>;
}

export type WorkspaceFilesStatus = "loading" | "ready" | "not_ready" | "error";

/** Backoff for "workspace not ready" retries (clone/sandbox still starting). */
const NOT_READY_RETRY_MS = [2000, 4000, 8000, 15000];

function dtoToNode(dto: WorkspaceNodeDto): WorkspaceFileNode {
  const id = `/${dto.path}`;
  if (dto.kind === "dir") {
    return {
      id,
      name: dto.name,
      kind: "folder",
      children: (dto.children ?? []).map(dtoToNode),
    };
  }
  return { id, name: dto.name, kind: "file", size: dto.size };
}

/** Real data source: the gateway proxies the sandbox filesystem. */
export const sandboxWorkspaceDataSource: WorkspaceDataSource = {
  loadFiles: async (sessionId, options) => {
    const workspace = await getWorkspaceTree(sessionId, options ?? {});
    return {
      rootName: workspace.rootName || "workspace",
      entries: workspace.entries.map(dtoToNode),
      ...(workspace.truncated ? { truncated: true } : {}),
    };
  },
};

/** The UI's only binding — swap point kept from the original boundary. */
export const workspaceDataSource: WorkspaceDataSource = sandboxWorkspaceDataSource;

/* ------------------------------------------------------------------ */
/* Tree helpers                                                        */
/* ------------------------------------------------------------------ */

export interface WorkspaceFileMatch {
  node: WorkspaceFileNode;
  /** Parent folder path relative to the root (`Frontend/src`). */
  path: string;
}

/**
 * Flat file matches for the explorer's filter input.
 * Files only (folders are navigated in the tree, not searched into).
 */
export function filterFileTree(tree: WorkspaceFileTree, query: string): WorkspaceFileMatch[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const matches: WorkspaceFileMatch[] = [];
  function walk(nodes: WorkspaceFileNode[], parents: string[]) {
    for (const node of nodes) {
      const path = [...parents, node.name];
      if (node.kind === "file" && node.name.toLowerCase().includes(q)) {
        matches.push({ node, path: parents.join("/") });
      }
      if (node.children) walk(node.children, path);
    }
  }
  walk(tree.entries, []);
  return matches;
}

/** Collect every folder id at `depth <= maxDepth` (initial expand state). */
export function defaultExpandedIds(entries: WorkspaceFileNode[], maxDepth = 2): Set<string> {
  const ids = new Set<string>();
  function walk(nodes: WorkspaceFileNode[], depth: number) {
    for (const node of nodes) {
      if (node.kind !== "folder") continue;
      if (depth <= maxDepth) {
        ids.add(node.id);
        if (node.children) walk(node.children, depth + 1);
      }
    }
  }
  walk(entries, 0);
  return ids;
}

/* ------------------------------------------------------------------ */
/* Incremental tree updates (realtime events)                          */
/* ------------------------------------------------------------------ */

/** Split a relative path (`Frontend/src/App.jsx`) into segments. */
function segmentsOf(relPath: string): string[] {
  return relPath.split("/").filter(Boolean);
}

/** `id` form of a relative path (`/Frontend/src/App.jsx`). */
function idOf(relPath: string): string {
  return `/${segmentsOf(relPath).join("/")}`;
}

function cloneWithChildren(node: WorkspaceFileNode, children: WorkspaceFileNode[]): WorkspaceFileNode {
  return { ...node, children };
}

/** Insert `node` into `entries` (folders first, alphabetical). */
function insertSorted(entries: WorkspaceFileNode[], node: WorkspaceFileNode): WorkspaceFileNode[] {
  const next = [...entries, node];
  next.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return next;
}

/** Remove the direct child named `name` from `entries`. */
function removeChild(entries: WorkspaceFileNode[], name: string): WorkspaceFileNode[] | null {
  const index = entries.findIndex((entry) => entry.name === name);
  if (index === -1) return null;
  const next = [...entries];
  next.splice(index, 1);
  return next;
}

/**
 * Apply a filesystem event to the tree.
 *
 * Returns the updated tree, `null` when the event cannot be applied
 * safely (unknown parent, contradictory ordering) — the caller should
 * resync the full tree in that case. Unknown-but-harmless events (e.g.
 * `updated` for a file we already show) return the tree unchanged.
 */
export function applyWorkspaceEvent(
  tree: WorkspaceFileTree,
  event: { type: string; path?: string; oldPath?: string; newPath?: string },
): WorkspaceFileTree | null {
  if (!event.path && !event.newPath) {
    // `updated` events without a path (shouldn't happen) — no-op.
    if (event.type === "workspace.file.updated") return tree;
    return null;
  }

  const relPath = event.path ?? event.newPath!;

  if (event.type === "workspace.file.created" || event.type === "workspace.file.updated") {
    const segments = segmentsOf(relPath);
    const fileName = segments[segments.length - 1];
    if (!fileName) return tree;

    // If the node already exists, nothing to change in the tree shape.
    if (findNodeByRelPath(tree.entries, relPath)) return tree;

    const isCreate = event.type === "workspace.file.created";
    return insertAtPath(tree, segments, (name, existingChildren) => {
      const node: WorkspaceFileNode = {
        id: idOf(segments.join("/")),
        name,
        kind: "file",
      };
      void existingChildren;
      return node;
    }, isCreate);
  }

  if (event.type === "workspace.file.deleted") {
    return removeAtPath(tree, segmentsOf(relPath));
  }

  if (event.type === "workspace.file.renamed") {
    const target = event.newPath ?? event.path;
    const source = event.oldPath ?? event.path;
    if (!target || !source) return null;
    const node = findNodeByRelPath(tree.entries, source);
    if (!node) return null; // Resync — we can't synthesize the moved node.
    const removed = removeAtPath(tree, segmentsOf(source));
    if (!removed) return null;
    const moved = retype(node, target);
    return insertAtPath(removed, segmentsOf(target), () => moved, true);
  }

  // Unknown event types: ask for a resync rather than guessing.
  return null;
}

/** Rebuild a node (and descendant path ids) for a new relative path. */
function retype(node: WorkspaceFileNode, newRelPath: string): WorkspaceFileNode {
  const rebuilt: WorkspaceFileNode = {
    ...node,
    id: idOf(newRelPath),
    name: segmentsOf(newRelPath).pop() ?? node.name,
  };
  if (node.children) {
    rebuilt.children = node.children.map((child) => {
      const childRel = `${newRelPath}/${child.name}`;
      return retype(child, childRel);
    });
  }
  return rebuilt;
}

function findNodeByRelPath(
  entries: WorkspaceFileNode[],
  relPath: string,
): WorkspaceFileNode | null {
  const segments = segmentsOf(relPath);
  let current: WorkspaceFileNode[] = entries;
  let found: WorkspaceFileNode | null = null;
  for (const segment of segments) {
    const next: WorkspaceFileNode | undefined = current.find((node) => node.name === segment);
    if (!next) return null;
    found = next;
    current = next.children ?? [];
  }
  return found;
}

/** Insert a file at `segments`, creating missing folder ancestors. */
function insertAtPath(
  tree: WorkspaceFileTree,
  segments: string[],
  makeNode: (name: string, siblings: WorkspaceFileNode[]) => WorkspaceFileNode,
  createParents: boolean,
): WorkspaceFileTree | null {
  if (segments.length === 0) return null;
  const [head, ...rest] = segments as [string, ...string[]];

  const index = tree.entries.findIndex((node) => node.name === head);
  if (rest.length === 0) {
    if (index !== -1) return tree; // Already present.
    const node = makeNode(head, tree.entries);
    return { ...tree, entries: insertSorted(tree.entries, node) };
  }

  if (index === -1) {
    if (!createParents) return null; // Unknown parent — resync.
    const childTree: WorkspaceFileTree = {
      rootName: tree.rootName,
      entries: [],
    };
    const built = insertAtPath(childTree, rest, makeNode, createParents);
    if (!built) return null;
    const folder: WorkspaceFileNode = {
      id: idOf(head),
      name: head,
      kind: "folder",
      children: built.entries,
    };
    return { ...tree, entries: insertSorted(tree.entries, folder) };
  }

  const existing = tree.entries[index]!;
  if (existing.kind !== "folder") return null;
  const childTree: WorkspaceFileTree = {
    rootName: tree.rootName,
    entries: existing.children ?? [],
  };
  const built = insertAtPath(childTree, rest, makeNode, createParents);
  if (!built || built.entries === childTree.entries) return tree;
  const next = [...tree.entries];
  next[index] = cloneWithChildren(existing, built.entries);
  return { ...tree, entries: next };
}

/** Remove the node at `segments`; no-op (same tree) when absent. */
function removeAtPath(tree: WorkspaceFileTree, segments: string[]): WorkspaceFileTree | null {
  if (segments.length === 0) return null;
  const [head, ...rest] = segments as [string, ...string[]];

  if (rest.length === 0) {
    const removed = removeChild(tree.entries, head);
    if (!removed) return tree; // Already gone — harmless.
    return { ...tree, entries: removed };
  }

  const index = tree.entries.findIndex((node) => node.name === head);
  if (index === -1) return tree;
  const existing = tree.entries[index]!;
  if (existing.kind !== "folder") return tree;

  const childTree: WorkspaceFileTree = {
    rootName: tree.rootName,
    entries: existing.children ?? [],
  };
  const built = removeAtPath(childTree, rest);
  if (!built) return null;
  if (built.entries === childTree.entries) return tree;
  const next = [...tree.entries];
  next[index] = cloneWithChildren(existing, built.entries);
  return { ...tree, entries: next };
}

/* ------------------------------------------------------------------ */
/* Load hook                                                           */
/* ------------------------------------------------------------------ */

interface UseWorkspaceFileTreeResult {
  status: WorkspaceFilesStatus;
  tree: WorkspaceFileTree | null;
  error: string | null;
  reload: () => void;
  /**
   * Apply a realtime filesystem event to the current tree.
   * Returns false when the event could not be applied — the caller
   * should `reload()` (tree resync) instead of risking a corrupt UI.
   */
  applyEvent: (event: { type: string; path?: string; oldPath?: string; newPath?: string }) => boolean;
}

/** Result of the latest completed load (keyed by session + version). */
interface FilesState {
  sessionId: string;
  version: number;
  /** `"loading"` only until the first load settles (see `stale`). */
  status: WorkspaceFilesStatus;
  tree: WorkspaceFileTree | null;
  error: string | null;
}

/**
 * Loads a session's file tree through the data source and exposes the
 * loading / not-ready / error / ready states the explorer renders.
 *
 * - Staleness is derived during render (`stale` below), so switching
 *   session or retrying shows "loading" without writing state inside the
 *   effect; in-flight loads are aborted on unmount / session switch.
 * - "not ready" (sandbox/clone still starting) retries with capped
 *   backoff while mounted — no manual action needed, but `reload()`
 *   resets the backoff immediately.
 * - `applyEvent` mutates the loaded tree incrementally from realtime
 *   workspace events; the socket layer falls back to `reload()` when an
 *   event cannot be applied or after a reconnect.
 */
export function useWorkspaceFileTree(
  source: WorkspaceDataSource,
  sessionId: string,
): UseWorkspaceFileTreeResult {
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<FilesState>({
    sessionId,
    version: 0,
    status: "loading",
    tree: null,
    error: null,
  });
  const notReadyCountRef = useRef(0);
  const treeRef = useRef<WorkspaceFileTree | null>(null);

  const reload = useCallback(() => {
    notReadyCountRef.current = 0;
    setVersion((v) => v + 1);
  }, []);

  // A load for this session/version hasn't landed yet → render loading.
  const stale = state.sessionId !== sessionId || state.version !== version;

  useEffect(() => {
    treeRef.current = stale ? null : state.tree;
  }, [stale, state.tree]);

  useEffect(() => {
    const controller = new AbortController();

    source
      .loadFiles(sessionId, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        notReadyCountRef.current = 0;
        setState({ sessionId, version, status: "ready", tree: result, error: null });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof WorkspaceNotReadyError) {
          setState({ sessionId, version, status: "not_ready", tree: null, error: null });
          return;
        }
        setState({
          sessionId,
          version,
          status: "error",
          tree: null,
          error: err instanceof Error ? err.message : "Couldn't load workspace files.",
        });
      });

    return () => controller.abort();
  }, [source, sessionId, version, stale]);

  // Not-ready backoff: schedule the next reload while nothing else drives it.
  useEffect(() => {
    if (stale || state.status !== "not_ready") return;
    const attempt = Math.min(notReadyCountRef.current, NOT_READY_RETRY_MS.length - 1);
    notReadyCountRef.current = attempt + 1;
    const timer = setTimeout(() => setVersion((v) => v + 1), NOT_READY_RETRY_MS[attempt]);
    return () => clearTimeout(timer);
  }, [stale, state.status, state.version]);

  const applyEvent = useCallback(
    (
      event: { type: string; path?: string; oldPath?: string; newPath?: string },
    ): boolean => {
      const current = treeRef.current;
      if (!current) return false;
      if (
        event.type !== "workspace.file.created" &&
        event.type !== "workspace.file.updated" &&
        event.type !== "workspace.file.deleted" &&
        event.type !== "workspace.file.renamed"
      ) {
        return true; // Resync/ready signals are handled by the caller.
      }
      const next = applyWorkspaceEvent(current, event);
      if (!next) return false;
      treeRef.current = next;
      setState((prev) =>
        prev.sessionId === sessionId && prev.status === "ready"
          ? { ...prev, tree: next }
          : prev,
      );
      return true;
    },
    [sessionId],
  );

  return {
    status: stale ? "loading" : state.status,
    tree: stale ? null : state.tree,
    error: stale ? null : state.error,
    reload,
    applyEvent,
  };
}
