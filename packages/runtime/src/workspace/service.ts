import path from "node:path";
import { TREE_SCAN_COALESCE_MS } from "./config.js";
import { createE2bAdapter } from "./fs-adapter.js";
import { readWorkspaceFile } from "./file-content.js";
import { scanWorkspace } from "./scanner.js";
import { WORKSPACE_PATH } from "../tools/git_tools/git_helpers.js";
import { sessionSandboxService } from "../sandbox/sessionSandboxService.js";
import { workspaceWatcherManager } from "./watcher.js";
import { WorkspaceFileError } from "./types.js";
import type { WorkspaceFileContent, WorkspaceTree } from "./types.js";

interface CoalescedScan {
    at: number;
    promise: Promise<WorkspaceTree>;
}

const ROOT_NAME = path.basename(WORKSPACE_PATH) || "workspace";

function notReadyTree(): WorkspaceTree {
    return { status: "not_ready", rootName: ROOT_NAME, entries: [], truncated: false };
}

/**
 * In-flight dedup + short coalescing window: concurrent or bursty tree
 * requests for the same session share one scan (prevents duplicate
 * initialization storms when the sandbox, clone and frontend connect
 * concurrently).
 */
const inFlightScans = new Map<string, CoalescedScan>();

/**
 * Resolve the session's live sandbox, extend its lifetime, and reap dead
 * ones (refresh also stops the watcher when a sandbox is gone).
 * Returns null when the session has no running sandbox — the workspace is
 * "not ready" from the explorer's point of view.
 */
async function resolveSandbox(sessionId: string): Promise<string | null> {
    return sessionSandboxService.refresh(sessionId);
}

/** Tree for the session's workspace — the source of truth is the sandbox FS. */
export async function getWorkspaceTree(sessionId: string): Promise<WorkspaceTree> {
    const sandboxId = await resolveSandbox(sessionId);
    if (!sandboxId) {
        return notReadyTree();
    }

    const now = Date.now();
    const existing = inFlightScans.get(sessionId);
    if (existing && now - existing.at < TREE_SCAN_COALESCE_MS) {
        return existing.promise;
    }

    const promise = (async (): Promise<WorkspaceTree> => {
        const adapter = createE2bAdapter(sandboxId);
        const scan = await scanWorkspace(adapter, WORKSPACE_PATH);
        if (scan.unreadableDirs.length > 0) {
            console.warn(
                `[Workspace] ${scan.unreadableDirs.length} unreadable dir(s) in session ${sessionId}:`,
                scan.unreadableDirs.slice(0, 5).join(", "),
            );
        }
        return {
            status: "ready",
            rootName: scan.rootName,
            entries: scan.entries,
            truncated: scan.truncated,
        };
    })();

    inFlightScans.set(sessionId, { at: now, promise });
    try {
        return await promise;
    } finally {
        const current = inFlightScans.get(sessionId);
        if (current?.promise === promise) inFlightScans.delete(sessionId);
    }
}

/** Contents of a single workspace file for the session's sandbox. */
export async function getWorkspaceFile(
    sessionId: string,
    rawPath: string,
): Promise<WorkspaceFileContent> {
    const sandboxId = await resolveSandbox(sessionId);
    if (!sandboxId) {
        throw new WorkspaceFileError("NOT_READY", "Workspace is not ready yet");
    }
    const adapter = createE2bAdapter(sandboxId);
    return readWorkspaceFile(adapter, WORKSPACE_PATH, rawPath);
}

/**
 * Re-arm the watcher if it is not running (e.g. after a runtime restart).
 * Called from the tree RPC and the sandbox lifecycle hooks.
 */
export function ensureWorkspaceWatching(sessionId: string, sandboxId: string): void {
    if (workspaceWatcherManager.isWatching(sessionId, sandboxId)) return;
    void workspaceWatcherManager.ensureWatching(sessionId, sandboxId);
}
