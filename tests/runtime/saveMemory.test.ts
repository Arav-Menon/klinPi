import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSaveMemoryTool } from "../../packages/runtime/src/tools/save_memory.js";
import type { ToolContext } from "../../packages/runtime/src/types.js";

function createContext(
    overrides?: Partial<ToolContext>,
): ToolContext & { createMemory: ReturnType<typeof vi.fn> } {
    const createMemory = vi.fn().mockResolvedValue({
        id: "mem-1",
        type: "FACT",
        importance: "MEDIUM",
    });
    return {
        memoryService: { createMemory } as unknown as ToolContext["memoryService"],
        userId: "user-1",
        sessionId: "session-1",
        repositoryId: "repo-1",
        createMemory,
        ...overrides,
    } as ToolContext & { createMemory: ReturnType<typeof vi.fn> };
}

describe("save_memory tool", () => {
    let ctx: ReturnType<typeof createContext>;
    let tool: ReturnType<typeof createSaveMemoryTool>;

    beforeEach(() => {
        ctx = createContext();
        tool = createSaveMemoryTool(ctx);
    });

    it("should save with defaults (FACT, MEDIUM, repository scope)", async () => {
        const result = await tool.execute(
            { content: "User prefers concise bullet-point answers" },
            "",
        );

        expect(ctx.createMemory).toHaveBeenCalledWith({
            userId: "user-1",
            sessionId: "session-1",
            repositoryId: "repo-1",
            type: "FACT",
            content: "User prefers concise bullet-point answers",
            importance: "MEDIUM",
        });
        expect(result).toContain("Memory saved: mem-1");
        expect(result).toContain("scope=repository");
    });

    it("should save as global scope with no repositoryId", async () => {
        const result = await tool.execute(
            { content: "Always use TypeScript strict mode", scope: "global" },
            "",
        );

        expect(ctx.createMemory).toHaveBeenCalledWith(
            expect.objectContaining({
                repositoryId: null,
                type: "FACT",
            }),
        );
        expect(result).toContain("scope=global");
    });

    it("should default to global scope when no repository is attached", async () => {
        const noRepoCtx = createContext({ repositoryId: null });
        const noRepoTool = createSaveMemoryTool(noRepoCtx);

        await noRepoTool.execute({ content: "Some durable fact" }, "");

        expect(noRepoCtx.createMemory).toHaveBeenCalledWith(
            expect.objectContaining({ repositoryId: null }),
        );
    });

    it("should pass explicit type and importance", async () => {
        await tool.execute(
            {
                content: "Repo uses FastAPI with in-memory storage in lesson 1",
                type: "REPOSITORY_KNOWLEDGE",
                importance: "HIGH",
            },
            "",
        );

        expect(ctx.createMemory).toHaveBeenCalledWith(
            expect.objectContaining({
                type: "REPOSITORY_KNOWLEDGE",
                importance: "HIGH",
            }),
        );
    });

    it("should reject missing content", async () => {
        const result = await tool.execute({}, "");
        expect(result).toContain("'content' is required");
        expect(ctx.createMemory).not.toHaveBeenCalled();
    });

    it("should reject an invalid type", async () => {
        const result = await tool.execute(
            { content: "some fact", type: "NOT_A_TYPE" },
            "",
        );
        expect(result).toContain("invalid type 'NOT_A_TYPE'");
        expect(ctx.createMemory).not.toHaveBeenCalled();
    });

    it("should reject an invalid importance", async () => {
        const result = await tool.execute(
            { content: "some fact", importance: "URGENT" },
            "",
        );
        expect(result).toContain("invalid importance 'URGENT'");
        expect(ctx.createMemory).not.toHaveBeenCalled();
    });

    it("should reject an invalid scope", async () => {
        const result = await tool.execute(
            { content: "some fact", scope: "team" },
            "",
        );
        expect(result).toContain("invalid scope 'team'");
        expect(ctx.createMemory).not.toHaveBeenCalled();
    });

    it("should return an error string when the memory service fails", async () => {
        ctx.createMemory.mockRejectedValueOnce(new Error("db down"));

        const result = await tool.execute({ content: "some fact" }, "");

        expect(result).toContain("Error saving memory: db down");
    });

    it("should return the existing id when content is a duplicate", async () => {
        ctx.createMemory.mockResolvedValueOnce({
            id: "mem-existing",
            type: "FACT",
            importance: "MEDIUM",
        });

        const result = await tool.execute({ content: "repeated fact" }, "");

        expect(result).toContain("Memory saved: mem-existing");
    });
});
