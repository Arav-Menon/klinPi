import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
    WorkspaceWatcherManager,
    coalesceWatchEvents,
} from "../../packages/runtime/src/workspace/watcher.js";
import type {
    WorkspaceAdapter,
    WorkspaceListEntry,
    WorkspaceRawWatchEvent,
    WorkspaceStat,
    WorkspaceWatchHandle,
} from "../../packages/runtime/src/workspace/types.js";
import type { WorkspaceEvent } from "../../packages/runtime/src/workspace/events.js";

/**
 * Fake adapter: startWatch captures the callbacks so tests drive the raw
 * event stream directly. No real filesystem or timers beyond debounce.
 */

interface FakeWatch {
    root: string;
    onEvent: (event: WorkspaceRawWatchEvent) => void;
    onExit: (error?: Error) => void;
    stopped: boolean;
}

function createFakeAdapter() {
    const watches: FakeWatch[] = [];
    const adapter: WorkspaceAdapter = {
        async listDir(_absPath: string): Promise<WorkspaceListEntry[]> {
            return [];
        },
        async stat(_absPath: string): Promise<WorkspaceStat> {
            return { type: "dir", size: 0 };
        },
        async read(): Promise<Uint8Array> {
            return new Uint8Array();
        },
        async startWatch(
            root: string,
            onEvent: (event: WorkspaceRawWatchEvent) => void,
            onExit: (error?: Error) => void,
        ): Promise<WorkspaceWatchHandle> {
            const watch: FakeWatch = { root, onEvent, onExit, stopped: false };
            watches.push(watch);
            return {
                async stop() {
                    watch.stopped = true;
                },
            };
        },
    };
    return { adapter, watches };
}

function createManager(debounceMs = 5) {
    const { adapter, watches } = createFakeAdapter();
    const published: Array<{ sessionId: string; event: WorkspaceEvent }> = [];
    const manager = new WorkspaceWatcherManager({
        createAdapter: () => adapter,
        publish: async (sessionId, event) => {
            published.push({ sessionId, event });
        },
        workspaceRoot: "/workspace",
        debounceMs,
    });
    return { manager, watches, published };
}

function flushDebounce(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms + 10));
}

afterEach(() => {
    vi.useRealTimers();
});

describe("coalesceWatchEvents", () => {
    it("nets create+delete of the same path to nothing (resync not needed)", () => {
        const result = coalesceWatchEvents([
            { type: "created", path: "tmp.txt" },
            { type: "deleted", path: "tmp.txt" },
        ]);
        expect(result).toBeNull();
    });

    it("keeps the first kind across create-then-update", () => {
        const result = coalesceWatchEvents([
            { type: "created", path: "a.ts" },
            { type: "updated", path: "a.ts" },
        ]);
        expect(result).toEqual([{ type: "workspace.file.created", path: "a.ts" }]);
    });

    it("deduplicates repeated updates", () => {
        const result = coalesceWatchEvents([
            { type: "updated", path: "a.ts" },
            { type: "updated", path: "a.ts" },
        ]);
        expect(result).toEqual([{ type: "workspace.file.updated", path: "a.ts" }]);
    });

    it("marks deleted paths", () => {
        const result = coalesceWatchEvents([
            { type: "updated", path: "keep.ts" },
            { type: "deleted", path: "gone.ts" },
        ]);
        expect(result).toEqual(
            expect.arrayContaining([
                { type: "workspace.file.updated", path: "keep.ts" },
                { type: "workspace.file.deleted", path: "gone.ts" },
            ]),
        );
    });

    it("returns null on renames (client must resync)", () => {
        expect(
            coalesceWatchEvents([
                { type: "renamed", path: "b.ts", oldPath: "a.ts" },
                { type: "updated", path: "c.ts" },
            ]),
        ).toBeNull();
    });

    it("returns null for oversized batches", () => {
        const batch = Array.from({ length: 101 }, (_, i) => ({
            type: "updated" as const,
            path: `f${i}.ts`,
        }));
        expect(coalesceWatchEvents(batch)).toBeNull();
    });

    it("returns null for empty or fully-invalid batches", () => {
        expect(coalesceWatchEvents([])).toBeNull();
        expect(coalesceWatchEvents([{ type: "updated", path: "../escape.ts" }])).toBeNull();
        expect(coalesceWatchEvents([{ type: "other", path: "socket" }])).toBeNull();
    });
});

describe("WorkspaceWatcherManager", () => {
    it("starts one watcher per session and publishes workspace.ready", async () => {
        const { manager, watches, published } = createManager();
        await manager.ensureWatching("sess-1", "sbx-1");
        await manager.ensureWatching("sess-1", "sbx-1");

        expect(watches).toHaveLength(1);
        expect(watches[0]?.root).toBe("/workspace");
        expect(manager.isWatching("sess-1", "sbx-1")).toBe(true);
        expect(published.map((p) => p.event.type)).toEqual(["workspace.ready"]);
        await manager.stopAll();
    });

    it("re-keys the watcher when the sandbox changes", async () => {
        const { manager, watches, published } = createManager();
        await manager.ensureWatching("sess-1", "sbx-1");
        await manager.ensureWatching("sess-1", "sbx-2");

        expect(watches).toHaveLength(2);
        expect(watches[0]?.stopped).toBe(true);
        expect(manager.isWatching("sess-1", "sbx-1")).toBe(false);
        expect(manager.isWatching("sess-1", "sbx-2")).toBe(true);
        expect(published.filter((p) => p.event.type === "workspace.ready")).toHaveLength(2);
        await manager.stopAll();
    });

    it("debounces, coalesces and publishes file events", async () => {
        const { manager, watches, published } = createManager(5);
        await manager.ensureWatching("sess-1", "sbx-1");

        const watch = watches[0]!;
        watch.onEvent({ type: "created", path: "src/new.ts" });
        watch.onEvent({ type: "updated", path: "src/new.ts" });
        watch.onEvent({ type: "updated", path: "README.md" });
        watch.onEvent({ type: "deleted", path: "old.ts" });

        // Debounce window — nothing yet.
        expect(published.filter((p) => p.event.type !== "workspace.ready")).toHaveLength(0);

        await flushDebounce(5);

        const fileEvents = published.filter((p) => p.event.type.startsWith("workspace.file."));
        expect(fileEvents).toHaveLength(3);
        const byType = new Map(fileEvents.map((p) => [p.event.type, (p.event as { path?: string }).path]));
        expect(byType.get("workspace.file.created")).toBe("src/new.ts");
        expect(byType.get("workspace.file.updated")).toBe("README.md");
        expect(byType.get("workspace.file.deleted")).toBe("old.ts");
        await manager.stopAll();
    });

    it("drops events under ignored directories", async () => {
        const { manager, watches, published } = createManager(5);
        await manager.ensureWatching("sess-1", "sbx-1");

        watches[0]!.onEvent({ type: "updated", path: "node_modules/dep/index.js" });
        watches[0]!.onEvent({ type: "created", path: ".git/config" });
        watches[0]!.onEvent({ type: "updated", path: "src/ok.ts" });

        await flushDebounce(5);

        const fileEvents = published.filter((p) => p.event.type.startsWith("workspace.file."));
        expect(fileEvents).toHaveLength(1);
        expect(fileEvents[0]?.event).toMatchObject({ path: "src/ok.ts" });
        await manager.stopAll();
    });

    it("publishes resync_required for batches it cannot represent", async () => {
        const { manager, watches, published } = createManager(5);
        await manager.ensureWatching("sess-1", "sbx-1");

        watches[0]!.onEvent({ type: "renamed", path: "b.ts", oldPath: "a.ts" });
        await flushDebounce(5);

        expect(published.some((p) => p.event.type === "workspace.tree.resync_required")).toBe(true);
        expect(published.some((p) => p.event.type.startsWith("workspace.file."))).toBe(false);
        await manager.stopAll();
    });

    it("stops the underlying watch on stopWatching", async () => {
        const { manager, watches } = createManager();
        await manager.ensureWatching("sess-1", "sbx-1");
        await manager.stopWatching("sess-1");

        expect(watches[0]?.stopped).toBe(true);
        expect(manager.isWatching("sess-1")).toBe(false);
    });

    it("ignores raw events that arrive after stopWatching", async () => {
        const { manager, watches, published } = createManager(5);
        await manager.ensureWatching("sess-1", "sbx-1");
        const watch = watches[0]!;
        await manager.stopWatching("sess-1");

        watch.onEvent({ type: "updated", path: "late.ts" });
        await flushDebounce(5);

        expect(published.filter((p) => p.event.type.startsWith("workspace.file."))).toHaveLength(0);
    });

    it("restarts a watch that exits and keeps delivering events", async () => {
        vi.useFakeTimers();
        const { manager, watches, published } = createManager(5);
        await manager.ensureWatching("sess-1", "sbx-1");

        watches[0]!.onExit(new Error("watch died"));
        await vi.advanceTimersByTimeAsync(60_000);

        expect(watches).toHaveLength(2);
        expect(manager.isWatching("sess-1", "sbx-1")).toBe(true);

        // The restarted watch still delivers.
        watches[1]!.onEvent({ type: "updated", path: "after-restart.ts" });
        await vi.advanceTimersByTimeAsync(100);
        expect(
            published.some((p) => p.event.type === "workspace.file.updated"),
        ).toBe(true);
        await manager.stopAll();
    });

    it("drops the watcher after the restart cap is exhausted", async () => {
        vi.useFakeTimers();
        // First startWatch succeeds; every subsequent attempt fails, so the
        // backoff chain accumulates restarts until WATCH_MAX_RESTARTS.
        const { adapter, watches } = createFakeAdapter();
        const failingAdapter = {
            ...adapter,
            async startWatch(
                root: string,
                onEvent: (event: WorkspaceRawWatchEvent) => void,
                onExit: (error?: Error) => void,
            ): Promise<WorkspaceWatchHandle> {
                if (watches.length >= 1) throw new Error("sandbox unreachable");
                return adapter.startWatch(root, onEvent, onExit);
            },
        };
        const published: Array<{ sessionId: string; event: WorkspaceEvent }> = [];
        const manager = new WorkspaceWatcherManager({
            createAdapter: () => failingAdapter,
            publish: async (sessionId, event) => {
                published.push({ sessionId, event });
            },
            workspaceRoot: "/workspace",
            debounceMs: 5,
        });
        await manager.ensureWatching("sess-1", "sbx-1");

        // 1 initial exit + failed restarts until the cap (restarts >= 5).
        for (let i = 0; i < 8; i++) {
            watches[watches.length - 1]?.onExit(new Error("watch died"));
            await vi.advanceTimersByTimeAsync(120_000);
            if (!manager.isWatching("sess-1")) break;
        }

        expect(manager.isWatching("sess-1")).toBe(false);
        expect(
            published.some(
                (p) =>
                    p.event.type === "workspace.tree.resync_required" &&
                    (p.event as { reason?: string }).reason === "watch_error",
            ),
        ).toBe(true);
        await manager.stopAll();
    });

    it("tolerates a startWatch failure without leaving a stale entry", async () => {
        const manager = new WorkspaceWatcherManager({
            createAdapter: () => ({
                async listDir() {
                    return [];
                },
                async stat() {
                    return { type: "dir" as const, size: 0 };
                },
                async read() {
                    return new Uint8Array();
                },
                async startWatch() {
                    throw new Error("sandbox unreachable");
                },
            }),
            publish: async () => {},
            workspaceRoot: "/workspace",
        });

        await manager.ensureWatching("sess-1", "sbx-1");
        expect(manager.isWatching("sess-1")).toBe(false);
    });
});
