import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createLocalAdapter } from "../../packages/runtime/src/workspace/fs-adapter.js";
import { scanWorkspace } from "../../packages/runtime/src/workspace/scanner.js";
import { readWorkspaceFile } from "../../packages/runtime/src/workspace/file-content.js";
import { WorkspaceWatcherManager } from "../../packages/runtime/src/workspace/watcher.js";
import { workspaceEventEnvelope } from "../../packages/runtime/src/workspace/events.js";
import type { WorkspaceEvent } from "../../packages/runtime/src/workspace/events.js";

/**
 * Integration: the workspace explorer lifecycle against the local adapter —
 * the same code paths the gateway→runtime flow drives, minus E2B.
 *
 * Flow covered: initial tree scan → file content read → live watch events
 * (create/update/delete) coalesced and published as WORKSPACE_EVENT
 * envelopes → resync fallback. No GitHub, no E2B, no network.
 */

let root: string;
const adapter = createLocalAdapter();
const SESSION_ID = "sess-integration-1";

async function writeFile(rel: string, content: string): Promise<void> {
    const abs = path.join(root, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content);
}

function waitFor(
    predicate: () => boolean,
    timeoutMs = 2000,
): Promise<void> {
    return new Promise((resolve, reject) => {
        const started = Date.now();
        const tick = () => {
            if (predicate()) {
                resolve();
                return;
            }
            if (Date.now() - started > timeoutMs) {
                reject(new Error("waitFor timed out"));
                return;
            }
            setTimeout(tick, 20);
        };
        tick();
    });
}

beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "klinpi-flow-"));
    await writeFile("README.md", "# demo\n");
    await writeFile("src/index.ts", "export const version = 1;\n");
    await writeFile("src/lib/util.ts", "export const noop = () => {};\n");
    await fs.mkdir(path.join(root, "node_modules"), { recursive: true });
    await writeFile("node_modules/dep/index.js", "module.exports = 1;\n");
});

afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
});

describe("workspace explorer flow (local adapter)", () => {
    it("scans a tree, reads a file, then follows live changes to completion", async () => {
        // 1. Initial tree — same scan the runtime GetFileTree handler runs.
        const scan = await scanWorkspace(adapter, root);
        expect(scan.status).toBe("ready");
        expect(scan.rootName).toBe(path.basename(root));
        // Directories first, then files (same stable order the UI relies on).
        expect(scan.entries.map((e) => e.name)).toEqual(["src", "README.md"]);
        const src = scan.entries.find((e) => e.name === "src");
        // Directories first, then files.
        expect(src?.children?.map((c) => c.name)).toEqual(["lib", "index.ts"]);
        // node_modules is pruned.
        expect(JSON.stringify(scan.entries)).not.toContain("node_modules");

        // 2. File content — what the gateway file endpoint proxies.
        const file = await readWorkspaceFile(adapter, root, "src/index.ts");
        expect(file).toMatchObject({
            path: "src/index.ts",
            content: "export const version = 1;\n",
            encoding: "utf-8",
        });

        // 3. Start the watcher and publish into a capture buffer (stand-in
        //    for the Redis channel the realtime router subscribes).
        const published: WorkspaceEvent[] = [];
        const manager = new WorkspaceWatcherManager({
            createAdapter: () => adapter,
            publish: async (_sessionId, event) => {
                published.push(event);
            },
            workspaceRoot: root,
            debounceMs: 30,
        });
        await manager.ensureWatching(SESSION_ID, "sbx-local");
        expect(manager.isWatching(SESSION_ID)).toBe(true);
        await waitFor(() => published.some((e) => e.type === "workspace.ready"));

        // 4. Live changes — create, update, delete.
        await writeFile("src/new-feature.ts", "export const feature = true;\n");
        await waitFor(() => published.some((e) => e.type === "workspace.file.created"));

        await writeFile("src/index.ts", "export const version = 2;\n");
        await waitFor(() =>
            published.some(
                (e) => e.type === "workspace.file.updated" && e.path === "src/index.ts",
            ),
        );

        await fs.rm(path.join(root, "src", "lib", "util.ts"));
        await waitFor(() =>
            published.some(
                (e) => e.type === "workspace.file.deleted" && e.path === "src/lib/util.ts",
            ),
        );

        // The updated file reflects the new content.
        const updated = await readWorkspaceFile(adapter, root, "src/index.ts");
        expect(updated.content).toBe("export const version = 2;\n");

        // 5. A rescan picks up the new file.
        const rescan = await scanWorkspace(adapter, root);
        const srcAfter = rescan.entries.find((e) => e.name === "src");
        expect(srcAfter?.children?.map((c) => c.name)).toContain("new-feature.ts");

        // 6. Every published event carries a valid WS envelope shape.
        for (const event of published) {
            const envelope = workspaceEventEnvelope(event);
            expect(envelope.type).toBe("WORKSPACE_EVENT");
            expect(envelope.event.sessionId).toBe(SESSION_ID);
            expect(typeof envelope.event.timestamp).toBe("number");
        }

        await manager.stopWatching(SESSION_ID);
        expect(manager.isWatching(SESSION_ID)).toBe(false);
    });

    it("confines traversal the same way the gateway file endpoint relies on", async () => {
        await writeFile("secret.txt", "top secret\n");
        await expect(
            readWorkspaceFile(adapter, root, "../" + path.basename(root) + "/secret.txt"),
        ).rejects.toMatchObject({ code: "INVALID_PATH" });
        await expect(readWorkspaceFile(adapter, root, "secret.txt")).resolves.toMatchObject({
            content: "top secret\n",
        });
    });
});
