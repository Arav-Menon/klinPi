/**
 * Canonical workspace types shared (by mirror) with the gateway REST layer
 * and the studio browser client. The internal RPC contract is
 * `packages/contracts/workspace.proto` — keep the two in sync.
 */

export type WorkspaceNodeKind = "file" | "dir";

export interface WorkspaceNode {
    /** Entry name (no path separators). */
    name: string;
    /** Path relative to the workspace root (no leading slash). */
    path: string;
    kind: WorkspaceNodeKind;
    /** Size in bytes — 0 for directories. */
    size: number;
    /** Child entries — populated on directories only. */
    children?: WorkspaceNode[];
}

export type WorkspaceTreeStatus = "ready" | "not_ready";

export interface WorkspaceTree {
    status: WorkspaceTreeStatus;
    /** Root folder name shown as the explorer heading. */
    rootName: string;
    entries: WorkspaceNode[];
    /** True when the scan hit the entry/depth cap — the tree is partial. */
    truncated: boolean;
}

export interface WorkspaceFileContent {
    /** Path relative to the workspace root (no leading slash). */
    path: string;
    content: string;
    size: number;
    encoding: "utf-8";
}

/** Typed failure modes of the file-content operation. */
export type WorkspaceFileErrorCode =
    | "INVALID_PATH"
    | "NOT_FOUND"
    | "NOT_A_FILE"
    | "TOO_LARGE"
    | "BINARY"
    | "UNREADABLE"
    | "NOT_READY";

export class WorkspaceFileError extends Error {
    readonly code: WorkspaceFileErrorCode;

    constructor(code: WorkspaceFileErrorCode, message: string) {
        super(message);
        this.name = "WorkspaceFileError";
        this.code = code;
    }
}

/** Minimal directory entry surfaced by a {@link WorkspaceAdapter} list. */
export interface WorkspaceListEntry {
    name: string;
    type: "file" | "dir" | "symlink" | "other";
    size: number;
}

export interface WorkspaceStat {
    type: "file" | "dir" | "symlink" | "other";
    size: number;
}

/** Raw filesystem event reported by an adapter watcher (relative path). */
export interface WorkspaceRawWatchEvent {
    type: "created" | "updated" | "deleted" | "renamed" | "other";
    /** Path relative to the watched root. */
    path: string;
    /** Original path for renames when the adapter can supply it. */
    oldPath?: string;
}

export interface WorkspaceWatchHandle {
    stop(): Promise<void>;
}

/** Adapter over a workspace filesystem (E2B sandbox in production). */
export interface WorkspaceAdapter {
    /** Absolute-rooted list of a directory's immediate entries. */
    listDir(absPath: string): Promise<WorkspaceListEntry[]>;
    /** Absolute-rooted stat of a single entry. */
    stat(absPath: string): Promise<WorkspaceStat>;
    /** Absolute-rooted bounded read of a regular file. */
    read(absPath: string, maxBytes: number): Promise<Uint8Array>;
    /**
     * Start watching a directory recursively. Events report paths relative
     * to `absRoot`. `onExit` fires when the watch terminates on its own.
     */
    startWatch(
        absRoot: string,
        onEvent: (event: WorkspaceRawWatchEvent) => void,
        onExit: (error?: Error) => void,
    ): Promise<WorkspaceWatchHandle>;
}
