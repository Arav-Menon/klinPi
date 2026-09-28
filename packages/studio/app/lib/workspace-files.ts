"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Workspace file-data boundary.
 *
 * The workspace UI (file explorer, recent files) consumes file trees
 * ONLY through `WorkspaceDataSource` — components never see mock nodes
 * directly. Today the binding is the isolated mock source below; when
 * the sandbox filesystem becomes available the plan is:
 *
 *   UI → `workspaceDataSource` (this module) → sandbox API / WebSocket
 *
 * i.e. implement `WorkspaceDataSource` against the future endpoint and
 * swap the single `workspaceDataSource` export. No component changes.
 * Nothing in this module talks to a backend, sandbox or WebSocket.
 */

export type WorkspaceFileKind = "file" | "folder";

export interface WorkspaceFileNode {
  /** Stable id: the entry's path inside the tree (`/Frontend/src/App.jsx`). */
  id: string;
  name: string;
  kind: WorkspaceFileKind;
  /** Child entries — present on folders only. */
  children?: WorkspaceFileNode[];
}

export interface WorkspaceFileTree {
  /** Root folder name, shown as the explorer heading (e.g. `COURsera-app`). */
  rootName: string;
  entries: WorkspaceFileNode[];
}

export interface WorkspaceDataSource {
  /** Load the file tree for a session's workspace. */
  loadFiles(sessionId: string, options?: { signal?: AbortSignal }): Promise<WorkspaceFileTree>;
}

export type WorkspaceFilesStatus = "loading" | "ready" | "error";

/* ------------------------------------------------------------------ */
/* Mock source — clearly isolated demo data (no network involved).     */
/* ------------------------------------------------------------------ */

/** Raw demo entry — `id`s are assigned by `withIds`. */
type RawEntry = {
  name: string;
  kind: WorkspaceFileKind;
  children?: RawEntry[];
};

const MOCK_ENTRIES: RawEntry[] = [
  {
    name: "Backend",
    kind: "folder",
    children: [
      {
        name: "controllers",
        kind: "folder",
        children: [
          { name: "auth.controller.js", kind: "file" },
          { name: "session.controller.js", kind: "file" },
        ],
      },
      {
        name: "middlewares",
        kind: "folder",
        children: [{ name: "auth.js", kind: "file" }],
      },
      { name: "backend.js", kind: "file" },
      { name: "routes.js", kind: "file" },
      { name: "package.json", kind: "file" },
    ],
  },
  {
    name: "Frontend",
    kind: "folder",
    children: [
      {
        name: "src",
        kind: "folder",
        children: [
          {
            name: "components",
            kind: "folder",
            children: [
              { name: "App.jsx", kind: "file" },
              { name: "Header.jsx", kind: "file" },
              { name: "Sidebar.jsx", kind: "file" },
              { name: "Modal.jsx", kind: "file" },
              { name: "Toast.jsx", kind: "file" },
            ],
          },
          {
            name: "hooks",
            kind: "folder",
            children: [
              { name: "useFetch.js", kind: "file" },
              { name: "useSession.js", kind: "file" },
            ],
          },
          {
            name: "utils",
            kind: "folder",
            children: [
              { name: "api.js", kind: "file" },
              { name: "format.js", kind: "file" },
            ],
          },
          { name: "main.jsx", kind: "file" },
          { name: "styles.css", kind: "file" },
        ],
      },
      {
        name: "public",
        kind: "folder",
        children: [
          { name: "logo.svg", kind: "file" },
          { name: "favicon.ico", kind: "file" },
        ],
      },
      { name: "index.html", kind: "file" },
      { name: "package.json", kind: "file" },
      { name: "vite.config.js", kind: "file" },
    ],
  },
  {
    name: "tests",
    kind: "folder",
    children: [
      { name: "app.test.js", kind: "file" },
      { name: "api.test.js", kind: "file" },
    ],
  },
  {
    name: "docs",
    kind: "folder",
    children: [
      { name: "api.md", kind: "file" },
      { name: "setup.md", kind: "file" },
      { name: "architecture.md", kind: "file" },
    ],
  },
  { name: ".gitignore", kind: "file" },
  { name: "README.md", kind: "file" },
];

const MOCK_ROOT = "COURsera-app";

function withIds(nodes: RawEntry[], parent = ""): WorkspaceFileNode[] {
  return nodes.map((node) => {
    const id = `${parent}/${node.name}`;
    if (node.kind === "folder") {
      return { id, name: node.name, kind: "folder" as const, children: withIds(node.children ?? [], id) };
    }
    return { id, name: node.name, kind: "file" as const };
  });
}

/** Demo source: resolves after a short delay so loading states are real. */
const mockWorkspaceDataSource: WorkspaceDataSource = {
  loadFiles: () =>
    new Promise((resolve) => {
      setTimeout(
        () => resolve({ rootName: MOCK_ROOT, entries: withIds(MOCK_ENTRIES) }),
        350,
      );
    }),
};

/**
 * THE plug point for the future sandbox integration.
 * Replace `mockWorkspaceDataSource` with a sandbox-backed
 * `WorkspaceDataSource` implementation — the UI only imports this.
 */
export const workspaceDataSource: WorkspaceDataSource = mockWorkspaceDataSource;

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
/* Load hook                                                           */
/* ------------------------------------------------------------------ */

interface UseWorkspaceFileTreeResult {
  status: WorkspaceFilesStatus;
  tree: WorkspaceFileTree | null;
  error: string | null;
  reload: () => void;
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
 * loading / error / ready states the explorer renders.
 *
 * Staleness is derived during render (`stale` below), so switching
 * session or retrying shows "loading" without writing state inside the
 * effect; in-flight loads are aborted on unmount / session switch /
 * reload.
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

  const reload = useCallback(() => setVersion((v) => v + 1), []);

  // A load for this session/version hasn't landed yet → render loading.
  const stale = state.sessionId !== sessionId || state.version !== version;

  useEffect(() => {
    const controller = new AbortController();

    source
      .loadFiles(sessionId, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        setState({ sessionId, version, status: "ready", tree: result, error: null });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          sessionId,
          version,
          status: "error",
          tree: null,
          error: err instanceof Error ? err.message : "Couldn't load workspace files.",
        });
      });

    return () => controller.abort();
  }, [source, sessionId, version]);

  return {
    status: stale ? "loading" : state.status,
    tree: stale ? null : state.tree,
    error: stale ? null : state.error,
    reload,
  };
}
