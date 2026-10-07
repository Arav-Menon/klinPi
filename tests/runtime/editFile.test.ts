import { describe, it, expect, beforeEach, vi } from "vitest";

const computeMocks = vi.hoisted(() => ({
    listDir: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
}));

vi.mock("@klinpi/compute", () => ({
    listDir: computeMocks.listDir,
    readFile: computeMocks.readFile,
    writeFile: computeMocks.writeFile,
}));

import { createEditFileTool } from "../../packages/runtime/src/tools/file_tools/edit_file.js";
import { createReadFileTool } from "../../packages/runtime/src/tools/file_tools/read_file.js";
import type { ToolContext } from "../../packages/runtime/src/types.js";
import { createRunWorkflowState } from "../../packages/runtime/src/lib/workflowState.js";

function createContext(): ToolContext {
    return {
        memoryService: {} as ToolContext["memoryService"],
        userId: "user-1",
        sessionId: "session-1",
        repositoryId: null,
        workflow: createRunWorkflowState(),
    };
}

describe("edit_file tool", () => {
    beforeEach(() => {
        computeMocks.listDir.mockReset();
        computeMocks.writeFile.mockReset().mockResolvedValue(undefined);
    });

    it("returns an error when no sandbox is available", async () => {
        const result = await createEditFileTool(createContext()).execute(
            { path: "/workspace/Dockerfile", content: "FROM node" },
            "",
        );

        expect(String(result)).toContain("No sandbox available");
        expect(computeMocks.writeFile).not.toHaveBeenCalled();
    });

    it("rejects a relative path so repository files cannot be written to a random location", async () => {
        const result = await createEditFileTool(createContext()).execute(
            { path: "Dockerfile", content: "FROM node" },
            "sbx-1",
        );

        expect(String(result)).toContain("absolute path");
        expect(computeMocks.writeFile).not.toHaveBeenCalled();
    });

    it("rejects a non-string content argument", async () => {
        const result = await createEditFileTool(createContext()).execute(
            { path: "/workspace/Dockerfile", content: { from: "node" } },
            "sbx-1",
        );

        expect(String(result)).toContain("'content' must be a string");
        expect(computeMocks.writeFile).not.toHaveBeenCalled();
    });

    it("refuses to write before the repository has been inspected", async () => {
        const context = createContext();

        const result = await createEditFileTool(context).execute(
            { path: "/workspace/Dockerfile", content: "FROM node" },
            "sbx-1",
        );

        expect(String(result)).toContain("has not been inspected");
        expect(String(result)).toContain("list_files");
        expect(computeMocks.writeFile).not.toHaveBeenCalled();
        expect(context.workflow.writeCount).toBe(0);
    });

    it("refuses to overwrite an existing repository file that has not been read", async () => {
        computeMocks.listDir.mockResolvedValue(
            "Dockerfile (420 bytes)\nREADME.md (10 bytes)",
        );
        const context = createContext();
        context.workflow.inspected = true;

        const result = await createEditFileTool(context).execute(
            { path: "/workspace/Dockerfile", content: "FROM node" },
            "sbx-1",
        );

        expect(String(result)).toContain("already exists");
        expect(String(result)).toContain("read_file");
        expect(computeMocks.listDir).toHaveBeenCalledWith("sbx-1", "/workspace");
        expect(computeMocks.writeFile).not.toHaveBeenCalled();
        expect(context.workflow.writeCount).toBe(0);
    });

    it("writes a file that has been read first and records it", async () => {
        computeMocks.listDir.mockResolvedValue("Dockerfile (420 bytes)");
        const context = createContext();
        context.workflow.inspected = true;
        context.workflow.readPaths.add("/workspace/Dockerfile");

        const result = await createEditFileTool(context).execute(
            { path: "/workspace/Dockerfile", content: "FROM node:20\n" },
            "sbx-1",
        );

        expect(result).toBe("Successfully wrote file '/workspace/Dockerfile'");
        expect(computeMocks.writeFile).toHaveBeenCalledWith(
            "sbx-1",
            "/workspace/Dockerfile",
            "FROM node:20\n",
        );
        expect(context.workflow.writeCount).toBe(1);
        expect(context.workflow.writtenPaths.has("/workspace/Dockerfile")).toBe(true);
    });

    it("creates a new repository file after inspection without a prior read", async () => {
        computeMocks.listDir.mockResolvedValue("README.md (10 bytes)");
        const context = createContext();
        context.workflow.inspected = true;

        const result = await createEditFileTool(context).execute(
            { path: "/workspace/Dockerfile", content: "FROM node" },
            "sbx-1",
        );

        expect(result).toBe("Successfully wrote file '/workspace/Dockerfile'");
        expect(context.workflow.writeCount).toBe(1);
    });

    it("treats an unreadable parent directory as a new file", async () => {
        computeMocks.listDir.mockRejectedValue(new Error("no such directory"));
        const context = createContext();
        context.workflow.inspected = true;

        const result = await createEditFileTool(context).execute(
            { path: "/workspace/nested/dir/file.ts", content: "export {};" },
            "sbx-1",
        );

        expect(result).toBe("Successfully wrote file '/workspace/nested/dir/file.ts'");
        expect(context.workflow.writeCount).toBe(1);
    });

    it("skips the existence check for paths outside /workspace", async () => {
        const context = createContext();
        context.workflow.inspected = true;

        const result = await createEditFileTool(context).execute(
            { path: "/tmp/notes.txt", content: "hello" },
            "sbx-1",
        );

        expect(result).toBe("Successfully wrote file '/tmp/notes.txt'");
        expect(computeMocks.listDir).not.toHaveBeenCalled();
        expect(context.workflow.writeCount).toBe(1);
    });

    it("reports write failures without recording the write", async () => {
        computeMocks.writeFile.mockRejectedValue(new Error("read-only filesystem"));
        const context = createContext();
        context.workflow.inspected = true;

        const result = await createEditFileTool(context).execute(
            { path: "/workspace/Dockerfile", content: "FROM node" },
            "sbx-1",
        );

        expect(String(result)).toContain("Error writing file");
        expect(String(result)).toContain("read-only filesystem");
        expect(context.workflow.writeCount).toBe(0);
    });
});

describe("read_file tool", () => {
    beforeEach(() => {
        computeMocks.listDir.mockReset();
        computeMocks.readFile.mockReset();
    });

    it("returns an error when no sandbox is available", async () => {
        const result = await createReadFileTool(createContext()).execute(
            { path: "/workspace/main.py" },
            "",
        );

        expect(String(result)).toContain("No sandbox available");
        expect(computeMocks.readFile).not.toHaveBeenCalled();
    });

    it("records the read path and marks the repository as inspected", async () => {
        computeMocks.readFile.mockResolvedValue("print('hello')\n");
        const context = createContext();

        const result = await createReadFileTool(context).execute(
            { path: "/workspace/main.py" },
            "sbx-1",
        );

        expect(result).toBe("print('hello')\n");
        expect(context.workflow.inspected).toBe(true);
        expect(context.workflow.readPaths.has("/workspace/main.py")).toBe(true);
    });

    it("adds nothing to readPaths when the read fails", async () => {
        computeMocks.readFile.mockRejectedValue(new Error("ENOENT"));
        computeMocks.listDir.mockResolvedValue("README.md (10 bytes)");
        const context = createContext();

        const result = await createReadFileTool(context).execute(
            { path: "/workspace/missing.py" },
            "sbx-1",
        );

        expect(String(result)).toContain("Error reading file");
        expect(String(result)).toContain("/workspace");
        expect(context.workflow.readPaths.size).toBe(0);
    });
});
