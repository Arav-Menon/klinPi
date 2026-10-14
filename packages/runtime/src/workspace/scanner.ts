import path from "node:path";
import { BINARY_SNIFF_BYTES, WORKSPACE_MAX_TREE_DEPTH, WORKSPACE_MAX_TREE_ENTRIES } from "./config.js";
import { isIgnoredDir } from "./ignore.js";
import type { WorkspaceAdapter, WorkspaceNode, WorkspaceTree } from "./types.js";

export interface ScanOptions {
    maxEntries?: number;
    maxDepth?: number;
}

export interface ScanResult extends WorkspaceTree {
    /** Relative paths of directories that could not be listed ("." for the root). */
    unreadableDirs: string[];
}

/**
 * Recursively scan a workspace root into a typed tree.
 *
 * - Paths are relative to `rootAbs`; directories and files are explicit.
 * - Ignored directories are pruned (never descended into).
 * - Symlinks are never followed — they surface as plain file entries.
 * - Per-directory failures are tolerated (recorded, scan continues).
 * - File contents are never read; only names, types and sizes are captured.
 * - A missing root yields an empty, ready tree (readiness itself is
 *   determined by the caller from the sandbox lifecycle, not the scan).
 */
export async function scanWorkspace(
    adapter: WorkspaceAdapter,
    rootAbs: string,
    options: ScanOptions = {},
): Promise<ScanResult> {
    const maxEntries = options.maxEntries ?? WORKSPACE_MAX_TREE_ENTRIES;
    const maxDepth = options.maxDepth ?? WORKSPACE_MAX_TREE_DEPTH;

    const root = path.resolve(rootAbs);
    const rootName = path.basename(root) || "workspace";

    try {
        const rootStat = await adapter.stat(root);
        if (rootStat.type !== "dir") {
            return { status: "ready", rootName, entries: [], truncated: false, unreadableDirs: [] };
        }
    } catch {
        return { status: "ready", rootName, entries: [], truncated: false, unreadableDirs: [] };
    }

    const unreadableDirs: string[] = [];
    let truncated = false;
    let emitted = 0;

    async function scanDir(absDir: string, relDir: string, depth: number): Promise<WorkspaceNode[]> {
        if (depth > maxDepth) {
            truncated = true;
            return [];
        }

        let entries;
        try {
            entries = await adapter.listDir(absDir);
        } catch {
            unreadableDirs.push(relDir || ".");
            return [];
        }

        // Directories first, then files; alphabetical within each group —
        // a stable order across scans keeps UI diffs and tests predictable.
        entries.sort((a, b) => {
            if (a.type === "dir" && b.type !== "dir") return -1;
            if (a.type !== "dir" && b.type === "dir") return 1;
            return a.name.localeCompare(b.name);
        });

        const nodes: WorkspaceNode[] = [];
        for (const entry of entries) {
            if (emitted >= maxEntries) {
                truncated = true;
                break;
            }
            if (!entry.name || entry.name.includes("/")) continue;

            const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;

            if (entry.type === "dir") {
                if (isIgnoredDir(entry.name)) continue;
                emitted += 1;
                const children = await scanDir(path.join(absDir, entry.name), relPath, depth + 1);
                nodes.push({ name: entry.name, path: relPath, kind: "dir", size: 0, children });
                continue;
            }

            // "other" (sockets, fifos, dangling specials) is noise for a
            // workspace browser; files and symlinks surface as file entries
            // (symlinks are listed, never followed).
            if (entry.type === "other") continue;
            emitted += 1;
            nodes.push({ name: entry.name, path: relPath, kind: "file", size: entry.size });
        }
        return nodes;
    }

    const entries = await scanDir(root, "", 0);
    return { status: "ready", rootName, entries, truncated, unreadableDirs };
}

/** True when the sampled head of `bytes` looks binary (contains a NUL). */
export function looksBinary(bytes: Uint8Array): boolean {
    const limit = Math.min(bytes.byteLength, BINARY_SNIFF_BYTES);
    for (let i = 0; i < limit; i++) {
        if (bytes[i] === 0) return true;
    }
    return false;
}
