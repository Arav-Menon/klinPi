import { describe, it, expect, beforeEach, vi } from "vitest";

const listMocks = vi.hoisted(() => ({
    listDir: vi.fn(),
}));

vi.mock("@klinpi/compute", () => ({
    listDir: listMocks.listDir,
}));

import { createListFilesTool } from "../../packages/runtime/src/tools/file_tools/list_files.js";
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

describe("list_files tool", () => {
    beforeEach(() => {
        listMocks.listDir.mockReset();
    });

    it("should return an error when no sandbox is available", async () => {
        const result = await createListFilesTool(createContext()).execute({}, "");
        expect(result).toContain("No sandbox available");
        expect(listMocks.listDir).not.toHaveBeenCalled();
    });

    it("should list /workspace by default", async () => {
        listMocks.listDir.mockResolvedValue("README.md (120 bytes)\nbasic-crud/");

        const result = await createListFilesTool(createContext()).execute(
            {} as Record<string, any>,
            "sbx-1",
        );

        expect(listMocks.listDir).toHaveBeenCalledWith("sbx-1", "/workspace");
        expect(result).toBe(
            "Contents of /workspace:\nREADME.md (120 bytes)\nbasic-crud/",
        );
    });

    it("should list a custom path", async () => {
        listMocks.listDir.mockResolvedValue("main.py (42 bytes)");

        const result = await createListFilesTool(createContext()).execute(
            { path: "/workspace/basic-crud" } as Record<string, any>,
            "sbx-1",
        );

        expect(listMocks.listDir).toHaveBeenCalledWith("sbx-1", "/workspace/basic-crud");
        expect(result).toBe("Contents of /workspace/basic-crud:\nmain.py (42 bytes)");
    });

    it("should fall back to /workspace listing when the custom path fails", async () => {
        listMocks.listDir
            .mockRejectedValueOnce(new Error("no such directory"))
            .mockResolvedValueOnce("README.md (120 bytes)");

        const result = await createListFilesTool(createContext()).execute(
            { path: "/nope" } as Record<string, any>,
            "sbx-1",
        );

        expect(result).toContain("Error listing '/nope'");
        expect(result).toContain("Repository root is /workspace");
        expect(result).toContain("README.md (120 bytes)");
    });

    it("should return a static hint when listing /workspace itself fails", async () => {
        listMocks.listDir.mockRejectedValue(new Error("sandbox gone"));

        const result = await createListFilesTool(createContext()).execute(
            {} as Record<string, any>,
            "sbx-1",
        );

        expect(result).toContain("Error listing '/workspace'");
        expect(result).toContain("Repository root is /workspace");
    });

    it("should mark the repository as inspected after a successful listing", async () => {
        listMocks.listDir.mockResolvedValue("README.md (120 bytes)");
        const context = createContext();

        await createListFilesTool(context).execute({} as Record<string, any>, "sbx-1");

        expect(context.workflow.inspected).toBe(true);
    });

    it("should not mark the repository as inspected when the listing fails", async () => {
        listMocks.listDir.mockRejectedValue(new Error("sandbox gone"));
        const context = createContext();

        await createListFilesTool(context).execute({} as Record<string, any>, "sbx-1");

        expect(context.workflow.inspected).toBe(false);
    });
});
