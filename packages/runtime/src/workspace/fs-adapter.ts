import { watch as fsWatch } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Sandbox } from "@klinpi/compute";
import { sandboxManger } from "@klinpi/compute";
import type {
    WorkspaceAdapter,
    WorkspaceListEntry,
    WorkspaceRawWatchEvent,
    WorkspaceStat,
    WorkspaceWatchHandle,
} from "./types.js";

function mapE2bType(type: string | undefined): WorkspaceListEntry["type"] {
    switch (type) {
        case "dir":
            return "dir";
        case "file":
            return "file";
        case "symlink":
            return "symlink";
        default:
            return "other";
    }
}

/**
 * E2B-backed adapter — the production workspace filesystem. All operations
 * go through the sandbox manager's connection pool; paths are absolute
 * inside the sandbox (callers have already confined them to the root).
 */
export function createE2bAdapter(sandboxId: string): WorkspaceAdapter {
    const withSandbox = async <T>(fn: (sandbox: Sandbox) => Promise<T>): Promise<T> => {
        const sandbox = await sandboxManger.connectSbx(sandboxId);
        return fn(sandbox);
    };

    return {
        async listDir(absPath: string): Promise<WorkspaceListEntry[]> {
            return withSandbox(async (sandbox) => {
                const entries = await sandbox.files.list(absPath);
                return entries.map((entry) => ({
                    name: entry.name,
                    type: mapE2bType(entry.type),
                    size: Number(entry.size ?? 0),
                }));
            });
        },

        async stat(absPath: string): Promise<WorkspaceStat> {
            return withSandbox(async (sandbox) => {
                const info = await sandbox.files.getInfo(absPath);
                return { type: mapE2bType(info.type), size: Number(info.size ?? 0) };
            });
        },

        async read(absPath: string, maxBytes: number): Promise<Uint8Array> {
            return withSandbox(async (sandbox) => {
                const bytes = await sandbox.files.read(absPath, { format: "bytes" });
                if (bytes.byteLength > maxBytes) {
                    // Callers stat before reading; this guards races.
                    return bytes.subarray(0, maxBytes);
                }
                return bytes;
            });
        },

        async startWatch(
            absRoot: string,
            onEvent: (event: WorkspaceRawWatchEvent) => void,
            onExit: (error?: Error) => void,
        ): Promise<WorkspaceWatchHandle> {
            return withSandbox(async (sandbox) => {
                const handle = await sandbox.files.watchDir(
                    absRoot,
                    (event) => {
                        const type: WorkspaceRawWatchEvent["type"] =
                            event.type === "create"
                                ? "created"
                                : event.type === "write"
                                    ? "updated"
                                    : event.type === "remove"
                                        ? "deleted"
                                        : event.type === "rename"
                                            ? "renamed"
                                            : "other";
                        // `name` is relative to the watched directory.
                        onEvent({ type, path: event.name });
                    },
                    {
                        recursive: true,
                        // Disable the SDK watch timeout — lifecycle is owned
                        // by WorkspaceWatcherManager (stop/restart/cleanup).
                        timeoutMs: 0,
                        onExit: (error?: Error) => onExit(error),
                    },
                );
                return {
                    async stop() {
                        await handle.stop();
                    },
                };
            });
        },
    };
}

/**
 * Local-filesystem adapter over a root directory. Used by tests and the
 * isolated end-to-end harness — never in production (production sandboxes
 * are remote E2B instances).
 */
export function createLocalAdapter(): WorkspaceAdapter {
    return {
        async listDir(absPath: string): Promise<WorkspaceListEntry[]> {
            const dirents = await fs.readdir(absPath, { withFileTypes: true });
            const entries: WorkspaceListEntry[] = [];
            for (const dirent of dirents) {
                let type: WorkspaceListEntry["type"] = "other";
                let size = 0;
                if (dirent.isSymbolicLink()) {
                    type = "symlink";
                    try {
                        const target = await fs.stat(path.join(absPath, dirent.name));
                        size = target.size;
                    } catch {
                        // Dangling symlink — keep size 0.
                    }
                } else if (dirent.isDirectory()) {
                    type = "dir";
                } else if (dirent.isFile()) {
                    type = "file";
                    try {
                        const info = await fs.stat(path.join(absPath, dirent.name));
                        size = info.size;
                    } catch {
                        // Unreadable — size stays 0.
                    }
                }
                entries.push({ name: dirent.name, type, size });
            }
            return entries;
        },

        async stat(absPath: string): Promise<WorkspaceStat> {
            const info = await fs.lstat(absPath);
            if (info.isSymbolicLink()) return { type: "symlink", size: info.size };
            if (info.isDirectory()) return { type: "dir", size: info.size };
            if (info.isFile()) return { type: "file", size: info.size };
            return { type: "other", size: info.size };
        },

        async read(absPath: string, maxBytes: number): Promise<Uint8Array> {
            const handle = await fs.open(absPath, "r");
            try {
                const buffer = new Uint8Array(maxBytes + 1);
                const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0);
                return buffer.subarray(0, bytesRead);
            } finally {
                await handle.close();
            }
        },

        async startWatch(
            absRoot: string,
            onEvent: (event: WorkspaceRawWatchEvent) => void,
            onExit: (error?: Error) => void,
        ): Promise<WorkspaceWatchHandle> {
            const watcher = fsWatch(absRoot, { recursive: true }, (eventType, filename) => {
                if (!filename) return;
                const relPath = filename.toString().split(path.sep).join("/");
                if (eventType === "change") {
                    onEvent({ type: "updated", path: relPath });
                    return;
                }
                // `rename` covers create/delete/rename — disambiguate by stat.
                void fs
                    .stat(path.join(absRoot, relPath))
                    .then(() => {
                        onEvent({ type: "created", path: relPath });
                    })
                    .catch(() => {
                        onEvent({ type: "deleted", path: relPath });
                    });
            });
            watcher.on("error", (error) => {
                onExit(error instanceof Error ? error : new Error(String(error)));
            });
            return {
                async stop() {
                    watcher.close();
                },
            };
        },
    };
}
