"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { getWorkspaceFile, ApiError, type WorkspaceFileDto } from "@/lib/api";

/**
 * Selected-file content loading for the workspace explorer.
 *
 * The file is identified by its path relative to the workspace root (the
 * same id form the tree uses, minus the leading `/`). Content is fetched
 * on selection and re-fetched when the caller signals an external change
 * (`refreshKey`) — e.g. a `workspace.file.updated` realtime event for the
 * open file. No editor exists yet, so there are no unsaved local edits to
 * protect; when one arrives, refresh must conflict-check instead of
 * overwriting.
 */

export type WorkspaceContentState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; file: WorkspaceFileDto }
  | { status: "missing" }
  | { status: "unsupported"; message: string }
  | { status: "error"; message: string };

export interface UseWorkspaceContentResult {
  state: WorkspaceContentState;
  reload: () => void;
}

export function useWorkspaceContent(
  sessionId: string,
  path: string | null,
  refreshKey = 0,
): UseWorkspaceContentResult {
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<WorkspaceContentState>({ status: "idle" });
  const pathRef = useRef(path);

  pathRef.current = path;

  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!path) {
      setState({ status: "idle" });
      return;
    }

    const controller = new AbortController();
    setState({ status: "loading" });

    getWorkspaceFile(sessionId, path, { signal: controller.signal })
      .then((file) => {
        if (controller.signal.aborted || pathRef.current !== path) return;
        setState({ status: "ready", file });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || pathRef.current !== path) return;
        if (err instanceof ApiError) {
          if (err.status === 404) {
            // Deleted between listing and opening (or since).
            setState({ status: "missing" });
            return;
          }
          if (err.status === 413 || err.status === 400) {
            setState({ status: "unsupported", message: err.message });
            return;
          }
        }
        setState({
          status: "error",
          message: err instanceof Error ? err.message : "Couldn't load the file.",
        });
      });

    return () => controller.abort();
  }, [sessionId, path, version, refreshKey]);

  return { state, reload };
}
