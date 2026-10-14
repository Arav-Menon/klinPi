import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { scanWorkspace, looksBinary } from "../../packages/runtime/src/workspace/scanner.js";
import { createLocalAdapter } from "../../packages/runtime/src/workspace/fs-adapter.js";

let root: string;

async function writeFile(rel: string, content: string | Uint8Array = ""): Promise<void> {
    const abs = path.join(root, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content);
}

beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "klinpi-scan-"));
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.mkdir(path.join(root, "src", "components"), { recursive: true });
    await fs.mkdir(path.join(root, "node_modules"), { recursive: true });
    await fs.mkdir(path.join(root, ".git"), { recursive: true });
    await fs.mkdir(path.join(root, "dist"), { recursive: true });
    await writeFile("README.md", "# hello\n");
    await writeFile("src/index.ts", "export {}\n");
    await writeFile("src/components/Button.tsx", "export {}\n");
    await writeFile("src/ignored.txt", "hidden\n");
    await writeFile("node_modules/dep/index.js", "module.exports = {};\n");
    await writeFile(".git/config", "[core]\n");
    await writeFile("dist/bundle.js", "console.log(1)\n");
});

afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
});

describe("scanWorkspace (local adapter)", () => {
    it("builds a relative tree with directories first and stable ordering", async () => {
        const scan = await scanWorkspace(createLocalAdapter(), root);

        expect(scan.status).toBe("ready");
        expect(scan.rootName).toBe(path.basename(root));
        expect(scan.truncated).toBe(false);
        expect(scan.unreadableDirs).toEqual([]);

        const names = scan.entries.map((e) => e.name);
        expect(names).toEqual(["src", "README.md"]);
        expect(names.indexOf("src")).toBeLessThan(names.indexOf("README.md"));

        const src = scan.entries[0]!;
        expect(src).toMatchObject({ name: "src", kind: "dir", path: "src" });
        expect(src.children?.map((c) => c.name)).toEqual(["components", "ignored.txt", "index.ts"]);
        expect(src.children?.find((c) => c.name === "index.ts")).toMatchObject({
            kind: "file",
            path: "src/index.ts",
        });
    });

    it("prunes ignored directories and their contents", async () => {
        const scan = await scanWorkspace(createLocalAdapter(), root);
        const names = scan.entries.map((e) => e.name);
        expect(names).not.toContain("node_modules");
        expect(names).not.toContain(".git");
        expect(names).not.toContain("dist");

        const json = JSON.stringify(scan.entries);
        expect(json).not.toContain("dep/index.js");
        expect(json).not.toContain("bundle.js");
    });

    it("truncates when the entry cap is hit", async () => {
        const scan = await scanWorkspace(createLocalAdapter(), root, { maxEntries: 2 });
        expect(scan.truncated).toBe(true);
        const count = (function countNodes(nodes: typeof scan.entries): number {
            return nodes.reduce((acc, n) => acc + 1 + countNodes(n.children ?? []), 0);
        })(scan.entries);
        expect(count).toBeLessThanOrEqual(2);
    });

    it("truncates when the depth cap is exceeded", async () => {
        await writeFile("src/components/deep/leaf.ts", "x\n");
        try {
            const scan = await scanWorkspace(createLocalAdapter(), root, { maxDepth: 1 });
            expect(scan.truncated).toBe(true);
            const src = scan.entries.find((e) => e.name === "src");
            // src/components is scanned at depth 2 > maxDepth → pruned.
            const components = src?.children?.find((c) => c.name === "components");
            expect(components).toMatchObject({ kind: "dir", children: [] });
        } finally {
            await fs.rm(path.join(root, "src", "components", "deep"), { recursive: true, force: true });
        }
    });

    it("returns an empty ready tree when the root is missing", async () => {
        const scan = await scanWorkspace(createLocalAdapter(), path.join(root, "does-not-exist"));
        expect(scan).toEqual({
            status: "ready",
            rootName: "does-not-exist",
            entries: [],
            truncated: false,
            unreadableDirs: [],
        });
    });
});

describe("looksBinary", () => {
    it("flags a NUL byte in the sniff window", () => {
        expect(looksBinary(new Uint8Array([0x61, 0x00, 0x62]))).toBe(true);
    });

    it("accepts plain text", () => {
        expect(looksBinary(new TextEncoder().encode("hello\nworld\n"))).toBe(false);
    });

    it("only inspects the head of the buffer", () => {
        // BINARY_SNIFF_BYTES is 8192 — a NUL beyond the window is not seen.
        const bytes = new Uint8Array(9000);
        bytes.fill(0x61);
        bytes[8999] = 0;
        expect(looksBinary(bytes)).toBe(false);
    });
});
