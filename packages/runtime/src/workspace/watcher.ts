import {
    WATCH_BATCH_CAP,
    WATCH_DEBOUNCE_MS,
    WATCH_MAX_RESTARTS,
    WATCH_RESTART_BASE_MS,
} from "./config.js";
import { createE2bAdapter } from "./fs-adapter.js";
import { isIgnoredDir } from "./ignore.js";
import { normalizeRelativePath } from "./paths.js";
import { publishWorkspaceEvent, type WorkspacePublisher } from "./publish.js";
import { WORKSPACE_PATH } from "../tools/git_tools/git_helpers.js";
import type { WorkspaceAdapter, WorkspaceRawWatchEvent } from "./types.js";
import type { WorkspaceEvent, WorkspaceFileEventType } from "./events.js";

type CoalescedEvent = { type: WorkspaceFileEventType; path: string };

export interface WorkspaceWatcherDeps {
    /** Build an adapter for a provider sandbox id (E2B in production). */
    createAdapter: (sandboxId: string) => WorkspaceAdapter;
    publish: WorkspacePublisher;
    debounceMs?: number;
    /** Absolute workspace root inside the sandbox. */
    workspaceRoot: string;
}

interface WatcherEntry {
    sessionId: string;
    sandboxId: string;
    adapter: WorkspaceAdapter;
    handle: { stop(): Promise<void> } | null;
    buffer: WorkspaceRawWatchEvent[];
    timer: ReturnType<typeof setTimeout> | null;
    stopped: boolean;
    restarts: number;
}

function dropIgnored(raw: WorkspaceRawWatchEvent): boolean {
    const normalized = normalizeRelativePath(raw.path);
    if (normalized === null) return true;
    return normalized.split("/").some((segment) => isIgnoredDir(segment));
}

/**
 * Coalesce a batch of raw watch events into the minimal set of typed file
 * events. Returns `null` when the batch cannot be represented incrementally
 * (renames, oversized batches) and the client should resync instead.
 */
export function coalesceWatchEvents(raw: WorkspaceRawWatchEvent[]): CoalescedEvent[] | null {
    if (raw.length > WATCH_BATCH_CAP) return null;

    const net = new Map<string, "created" | "updated" | "deleted">();
    let sawRename = false;

    for (const event of raw) {
        const rel = normalizeRelativePath(event.path);
        if (rel === null) continue;

        if (event.type === "renamed") {
            // The watch stream does not reliably pair old/new paths.
            sawRename = true;
            continue;
        }
        if (event.type === "other") continue;

        const previous = net.get(rel);
        if (event.type === "deleted") {
            if (previous === "created") net.delete(rel);
            else net.set(rel, "deleted");
            continue;
        }
        if (event.type === "created") {
            net.set(rel, "created");
            continue;
        }
        // updated — keep the earlier created/deleted kind if present.
        if (previous === undefined) net.set(rel, "updated");
    }

    if (sawRename) return null;
    if (net.size === 0) return null;

    return [...net.entries()].map(([rel, kind]) => ({
        type:
            kind === "created"
                ? "workspace.file.created"
                : kind === "updated"
                    ? "workspace.file.updated"
                    : "workspace.file.deleted",
        path: rel,
    }));
}

/**
 * Owns the filesystem watcher lifecycle for every session workspace.
 *
 * - At most one watcher per session (re-keyed when the sandbox changes).
 * - Started only once the workspace is ready; stopped on teardown.
 * - Raw events are debounced/coalesced; unrepresentable batches fall back
 *   to a single `workspace.tree.resync_required`.
 * - A watch that exits on its own is restarted with bounded backoff, then
 *   dropped (the next ensure/GetTree re-arms it).
 */
export class WorkspaceWatcherManager {
    private readonly watchers = new Map<string, WatcherEntry>();
    private readonly deps: WorkspaceWatcherDeps;
    private readonly debounceMs: number;

    constructor(deps: WorkspaceWatcherDeps) {
        this.deps = deps;
        this.debounceMs = deps.debounceMs ?? WATCH_DEBOUNCE_MS;
    }

    /** True when a live watcher exists (optionally for a given sandbox). */
    isWatching(sessionId: string, sandboxId?: string): boolean {
        const entry = this.watchers.get(sessionId);
        if (!entry || entry.stopped) return false;
        if (sandboxId !== undefined && entry.sandboxId !== sandboxId) return false;
        return true;
    }

    async ensureWatching(sessionId: string, sandboxId: string): Promise<void> {
        const existing = this.watchers.get(sessionId);
        if (existing) {
            if (existing.sandboxId === sandboxId && !existing.stopped) return;
            await this.stopWatching(sessionId);
        }

        const adapter = this.deps.createAdapter(sandboxId);
        const entry: WatcherEntry = {
            sessionId,
            sandboxId,
            adapter,
            handle: null,
            buffer: [],
            timer: null,
            stopped: false,
            restarts: 0,
        };
        this.watchers.set(sessionId, entry);

        try {
            entry.handle = await adapter.startWatch(
                this.deps.workspaceRoot,
                (event) => this.onRawEvent(entry, event),
                (error) => this.onWatchExit(entry, error),
            );
        } catch (error) {
            this.watchers.delete(entry.sessionId);
            console.warn(
                `[Workspace] Watch start failed for session ${sessionId} sandbox ${sandboxId}:`,
                error instanceof Error ? error.message : error,
            );
            return;
        }

        if (entry.stopped) {
            // stopWatching raced the in-flight start — release the handle.
            try {
                await entry.handle?.stop();
            } catch {
                // Best-effort cleanup.
            }
            return;
        }

        console.log(
            `[Workspace] Watching session=${sessionId} sandbox=${sandboxId} root=${this.deps.workspaceRoot}`,
        );
        void this.emitEvent(entry, {
            sessionId,
            type: "workspace.ready",
            timestamp: Date.now(),
        });
    }

    async stopWatching(sessionId: string): Promise<void> {
        const entry = this.watchers.get(sessionId);
        if (!entry) return;
        entry.stopped = true;
        this.watchers.delete(sessionId);
        if (entry.timer) {
            clearTimeout(entry.timer);
            entry.timer = null;
        }
        entry.buffer = [];
        if (entry.handle) {
            try {
                await entry.handle.stop();
            } catch (error) {
                console.warn(
                    `[Workspace] Watch stop failed for session ${sessionId}:`,
                    error instanceof Error ? error.message : error,
                );
            }
        }
    }

    /** Stop every watcher (process shutdown). */
    async stopAll(): Promise<void> {
        await Promise.all([...this.watchers.keys()].map((id) => this.stopWatching(id)));
    }

    private onRawEvent(entry: WatcherEntry, event: WorkspaceRawWatchEvent): void {
        if (entry.stopped) return;
        if (dropIgnored(event)) return;

        entry.buffer.push(event);
        if (entry.timer) return;

        entry.timer = setTimeout(() => {
            entry.timer = null;
            const batch = entry.buffer;
            entry.buffer = [];
            this.flush(entry, batch);
        }, this.debounceMs);
        // Don't keep the process alive just for a debounce window.
        entry.timer.unref?.();
    }

    private flush(entry: WatcherEntry, batch: WorkspaceRawWatchEvent[]): void {
        if (entry.stopped) return;
        const coalesced = coalesceWatchEvents(batch);
        if (coalesced === null) {
            void this.emitEvent(entry, {
                sessionId: entry.sessionId,
                type: "workspace.tree.resync_required",
                reason: "coalesce",
                timestamp: Date.now(),
            });
            return;
        }
        for (const item of coalesced) {
            void this.emitEvent(entry, {
                sessionId: entry.sessionId,
                type: item.type,
                path: item.path,
                timestamp: Date.now(),
            });
        }
    }

    private async emitEvent(entry: WatcherEntry, event: WorkspaceEvent): Promise<void> {
        if (entry.stopped) return;
        await this.deps.publish(entry.sessionId, event);
    }

    private onWatchExit(entry: WatcherEntry, error?: Error): void {
        if (entry.stopped) return;
        console.warn(
            `[Workspace] Watch exited for session=${entry.sessionId} sandbox=${entry.sandboxId}:`,
            error instanceof Error ? error.message : error,
        );

        entry.handle = null;
        if (entry.timer) {
            clearTimeout(entry.timer);
            entry.timer = null;
        }
        entry.buffer = [];

        if (entry.restarts >= WATCH_MAX_RESTARTS) {
            this.watchers.delete(entry.sessionId);
            entry.stopped = true;
            void this.deps.publish(entry.sessionId, {
                sessionId: entry.sessionId,
                type: "workspace.tree.resync_required",
                reason: "watch_error",
                timestamp: Date.now(),
            });
            return;
        }

        const delay = WATCH_RESTART_BASE_MS * 2 ** entry.restarts;
        entry.restarts += 1;
        const timer = setTimeout(() => {
            void this.restart(entry);
        }, delay);
        timer.unref?.();
    }

    private async restart(entry: WatcherEntry): Promise<void> {
        if (entry.stopped || this.watchers.get(entry.sessionId) !== entry) return;
        try {
            entry.handle = await entry.adapter.startWatch(
                this.deps.workspaceRoot,
                (event) => this.onRawEvent(entry, event),
                (error) => this.onWatchExit(entry, error),
            );
            entry.restarts = 0;
            console.log(
                `[Workspace] Watch restarted session=${entry.sessionId} sandbox=${entry.sandboxId}`,
            );
        } catch (error) {
            this.onWatchExit(entry, error instanceof Error ? error : new Error(String(error)));
        }
    }
}

export const workspaceWatcherManager = new WorkspaceWatcherManager({
    createAdapter: (sandboxId) => createE2bAdapter(sandboxId),
    publish: publishWorkspaceEvent,
    workspaceRoot: WORKSPACE_PATH,
});
