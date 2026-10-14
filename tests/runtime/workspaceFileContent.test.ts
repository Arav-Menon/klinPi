import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { readWorkspaceFile } from "../../packages/runtime/src/workspace/file-content.js";
import { createLocalAdapter } from "../../packages/runtime/src/workspace/fs-adapter.js";
import { WorkspaceFileError } from "../../packages/runtime/src/workspace/types.js";

let root: string;
const adapter = createLocalAdapter();

async function writeFile(rel: string, content: string | Uint8Array): Promise<void> {
    const abs = path.join(root, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content);
}

beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "klinpi-file-"));
    await writeFile("src/app.ts", "export const answer = 42;\n");
    await writeFile("nested/dir/notes.md", "# notes\n");
    const binary = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]);
    await writeFile("logo.png", binary);
    await writeFile("big.txt", "x".repeat(4096));
});

afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
});

describe("readWorkspaceFile", () => {
    it("reads a utf-8 text file with its size", async () => {
        const file = await readWorkspaceFile(adapter, root, "src/app.ts");
        expect(file).toEqual({
            path: "src/app.ts",
            content: "export const answer = 42;\n",
            size: Buffer.byteLength("export const answer = 42;\n"),
            encoding: "utf-8",
        });
    });

    it("accepts a leading slash and normalizes it away", async () => {
        const file = await readWorkspaceFile(adapter, root, "/nested/dir/notes.md");
        expect(file.path).toBe("nested/dir/notes.md");
        expect(file.content).toBe("# notes\n");
    });

    it("rejects traversal attempts with INVALID_PATH", async () => {
        for (const raw of ["../outside.txt", "src/../../etc/passwd", "..", "a\0b.txt"]) {
            await expect(readWorkspaceFile(adapter, root, raw)).rejects.toMatchObject({
                code: "INVALID_PATH",
            });
        }
    });

    it("rejects paths that resolve to the root itself", async () => {
        await expect(readWorkspaceFile(adapter, root, "./")).rejects.toBeInstanceOf(WorkspaceFileError);
        await expect(readWorkspaceFile(adapter, root, "")).rejects.toMatchObject({ code: "INVALID_PATH" });
    });

    it("returns NOT_FOUND for a missing file", async () => {
        await expect(readWorkspaceFile(adapter, root, "src/nope.ts")).rejects.toMatchObject({
            code: "NOT_FOUND",
        });
    });

    it("returns NOT_A_FILE for a directory", async () => {
        await expect(readWorkspaceFile(adapter, root, "src")).rejects.toMatchObject({
            code: "NOT_A_FILE",
        });
    });

    it("enforces the size limit without reading the file", async () => {
        await expect(readWorkspaceFile(adapter, root, "big.txt", { maxBytes: 100 })).rejects.toMatchObject({
            code: "TOO_LARGE",
        });
    });

    it("rejects binary content detected in the head", async () => {
        await expect(readWorkspaceFile(adapter, root, "logo.png")).rejects.toMatchObject({
            code: "BINARY",
        });
    });

    it("strips invalid utf-8 instead of throwing (non-fatal decode)", async () => {
        await writeFile("invalid.txt", new Uint8Array([0x68, 0x69, 0xff, 0xfe, 0x21]));
        const file = await readWorkspaceFile(adapter, root, "invalid.txt");
        expect(file.content.startsWith("hi")).toBe(true);
    });
});
