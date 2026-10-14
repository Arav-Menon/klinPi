"use client";

import { useEffect } from "react";

/**
 * Workspace realtime event bus.
 *
 * The session page owns the single WebSocket; the file explorer lives
 * further down the tree (WorkspacePanel → FilesView). Instead of a new
 * state-management library or deep prop drilling, workspace-scoped
 * realtime signals flow through this tiny module-level bus — the same
 * pattern the app already uses for module-level caches
 * (`app/lib/current-user.ts`).
 */

/** Normalized `WORKSPACE_EVENT` payload delivered over the session socket. */
export interface WorkspaceFsEvent {
  sessionId?: string;
  type: string;
  path?: string;
  oldPath?: string;
  newPath?: string;
  reason?: string;
  timestamp?: number | string;
}

export type WorkspaceBusMessage =
  /** A `WORKSPACE_EVENT` frame arrived from the realtime socket. */
  | { kind: "fs_event"; event: WorkspaceFsEvent }
  /** The session socket connection status changed. */
  | { kind: "connection"; status: "connecting" | "connected" | "reconnecting" | "error" }
  /** The socket re-opened after a drop — request a fresh tree snapshot. */
  | { kind: "reconnected" };

type Listener = (message: WorkspaceBusMessage) => void;

const listeners = new Map<string, Set<Listener>>();

export function emitWorkspaceBus(sessionId: string, message: WorkspaceBusMessage): void {
  const set = listeners.get(sessionId);
  if (!set) return;
  for (const listener of [...set]) {
    try {
      listener(message);
    } catch (error) {
      console.error("Workspace bus listener failed:", error);
    }
  }
}

export function subscribeWorkspaceBus(sessionId: string, listener: Listener): () => void {
  let set = listeners.get(sessionId);
  if (!set) {
    set = new Set();
    listeners.set(sessionId, set);
  }
  set.add(listener);
  return () => {
    const current = listeners.get(sessionId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) listeners.delete(sessionId);
  };
}

/** Hook: invoke `handler` for every bus message of this session. */
export function useWorkspaceBusListener(
  sessionId: string,
  handler: (message: WorkspaceBusMessage) => void,
): void {
  useEffect(() => subscribeWorkspaceBus(sessionId, handler), [sessionId, handler]);
}
