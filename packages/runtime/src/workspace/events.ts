/**
 * Typed workspace filesystem events.
 *
 * Delivered to the browser as `{type:"WORKSPACE_EVENT", event}` envelopes on
 * the existing per-session realtime channel (`agent:session:{sessionId}`) —
 * metadata only, never file contents.
 */
export type WorkspaceEventType =
    | "workspace.ready"
    | "workspace.file.created"
    | "workspace.file.updated"
    | "workspace.file.deleted"
    | "workspace.file.renamed"
    | "workspace.tree.resync_required";

export type WorkspaceFileEventType =
    | "workspace.file.created"
    | "workspace.file.updated"
    | "workspace.file.deleted"
    | "workspace.file.renamed";

interface WorkspaceEventBase {
    sessionId: string;
    type: WorkspaceEventType;
    timestamp: number;
}

export interface WorkspaceReadyEvent extends WorkspaceEventBase {
    type: "workspace.ready";
}

export interface WorkspaceFileEvent extends WorkspaceEventBase {
    type: WorkspaceFileEventType;
    /** Path relative to the workspace root (no leading slash). */
    path: string;
    /** Previous path — present on renames when known. */
    oldPath?: string;
    /** New path — present on renames when known. */
    newPath?: string;
}

export interface WorkspaceResyncEvent extends WorkspaceEventBase {
    type: "workspace.tree.resync_required";
    /** Short diagnostic reason (resync, too_many_events, rename, watch_error). */
    reason?: string;
}

export type WorkspaceEvent = WorkspaceReadyEvent | WorkspaceFileEvent | WorkspaceResyncEvent;

export function isWorkspaceFileEvent(event: WorkspaceEvent): event is WorkspaceFileEvent {
    return (
        event.type === "workspace.file.created" ||
        event.type === "workspace.file.updated" ||
        event.type === "workspace.file.deleted" ||
        event.type === "workspace.file.renamed"
    );
}

/** WS/Redis envelope wrapper — mirrors the agent envelope convention. */
export interface WorkspaceEventEnvelope {
    type: "WORKSPACE_EVENT";
    event: WorkspaceEvent;
}

export function workspaceEventEnvelope(event: WorkspaceEvent): WorkspaceEventEnvelope {
    return { type: "WORKSPACE_EVENT", event };
}
