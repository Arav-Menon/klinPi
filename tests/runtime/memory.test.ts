import { describe, it, expect, beforeEach } from "vitest";
import { getDb } from "@klinpi/db";
import { schema } from "@klinpi/db";
import { eq } from "drizzle-orm";
import { MemoryService } from "../../packages/runtime/src/state/memory.js";
import type { EmbeddingProvider } from "../../packages/runtime/src/state/types.js";

class MockEmbeddingProvider implements EmbeddingProvider {
  readonly dimension = 1024;

  async embed(text: string): Promise<number[]> {
    const embedding = new Array(1024).fill(0);
    for (let i = 0; i < Math.min(text.length, 1024); i++) {
      embedding[i] = text.charCodeAt(i) / 1000;
    }
    return embedding;
  }

  async invalidate(_text: string): Promise<void> {}
}

const TEST_USER_ID = "test-user-memory-000";
const TEST_REPO_ID = "test-repo-memory-000";

describe("MemoryService", () => {
  let service: MemoryService;

  beforeEach(async () => {
    service = new MemoryService(new MockEmbeddingProvider());

    await getDb()
      .delete(schema.memories)
      .where(eq(schema.memories.userId, TEST_USER_ID));
  });

  describe("createMemory", () => {
    it("should create a memory with embedding", async () => {
      const memory = await service.createMemory({
        userId: TEST_USER_ID,
        type: "USER_PREFERENCE",
        content: "User prefers dark mode",
      });

      expect(memory).toBeDefined();
      expect(memory.id).toBeDefined();
      expect(memory.userId).toBe(TEST_USER_ID);
      expect(memory.type).toBe("USER_PREFERENCE");
      expect(memory.content).toBe("User prefers dark mode");
      expect(memory.embedding).toBeDefined();
      expect(memory.embedding!.length).toBe(1024);
      expect(memory.importance).toBe("MEDIUM");
    });

    it("should create a memory with repository scope", async () => {
      const memory = await service.createMemory({
        userId: TEST_USER_ID,
        repositoryId: TEST_REPO_ID,
        type: "REPOSITORY_KNOWLEDGE",
        content: "This repo uses Drizzle ORM",
        importance: "HIGH",
      });

      expect(memory.repositoryId).toBe(TEST_REPO_ID);
      expect(memory.importance).toBe("HIGH");
    });

    it("should return existing memory on duplicate", async () => {
      const first = await service.createMemory({
        userId: TEST_USER_ID,
        type: "USER_PREFERENCE",
        content: "User likes TypeScript",
      });

      const second = await service.createMemory({
        userId: TEST_USER_ID,
        type: "USER_PREFERENCE",
        content: "User likes TypeScript",
      });

      expect(second.id).toBe(first.id);
    });
  });

  describe("getMemory", () => {
    it("should retrieve a memory by id", async () => {
      const created = await service.createMemory({
        userId: TEST_USER_ID,
        type: "FACT",
        content: "Node.js is a runtime",
      });

      const found = await service.getMemory(TEST_USER_ID, created.id);
      expect(found).toBeDefined();
      expect(found!.content).toBe("Node.js is a runtime");
    });

    it("should return null for non-existent memory", async () => {
      const found = await service.getMemory(TEST_USER_ID, "non-existent-id");
      expect(found).toBeNull();
    });

    it("should not return memory belonging to another user", async () => {
      const created = await service.createMemory({
        userId: TEST_USER_ID,
        type: "FACT",
        content: "Private memory",
      });

      const found = await service.getMemory("other-user-id", created.id);
      expect(found).toBeNull();
    });
  });

  describe("listMemories", () => {
    it("should list memories for a user", async () => {
      await service.createMemory({
        userId: TEST_USER_ID,
        type: "USER_PREFERENCE",
        content: "Prefers vim",
      });
      await service.createMemory({
        userId: TEST_USER_ID,
        type: "FACT",
        content: "TypeScript is static",
      });

      const result = await service.listMemories(TEST_USER_ID);
      expect(result.memories.length).toBeGreaterThanOrEqual(2);
    });

    it("should filter by type", async () => {
      await service.createMemory({
        userId: TEST_USER_ID,
        type: "USER_PREFERENCE",
        content: "Prefers dark theme",
      });
      await service.createMemory({
        userId: TEST_USER_ID,
        type: "FACT",
        content: "PostgreSQL is a database",
      });

      const result = await service.listMemories(TEST_USER_ID, {
        type: "FACT",
      });

      expect(
        result.memories.every((m) => m.type === "FACT"),
      ).toBe(true);
    });

    it("should not include memories from other users", async () => {
      await service.createMemory({
        userId: TEST_USER_ID,
        type: "USER_PREFERENCE",
        content: "My private preference",
      });

      const result = await service.listMemories("other-user-id");
      expect(result.memories.length).toBe(0);
    });
  });

  describe("updateMemory", () => {
    it("should update memory content and re-embed", async () => {
      const created = await service.createMemory({
        userId: TEST_USER_ID,
        type: "USER_PREFERENCE",
        content: "Old preference",
      });

      const updated = await service.updateMemory(
        TEST_USER_ID,
        created.id,
        { content: "New preference" },
      );

      expect(updated).toBeDefined();
      expect(updated!.content).toBe("New preference");
      expect(updated!.embedding).toBeDefined();
      expect(updated!.embedding!.length).toBe(1024);
    });

    it("should update memory importance", async () => {
      const created = await service.createMemory({
        userId: TEST_USER_ID,
        type: "INSTRUCTION",
        content: "Always use semicolons",
      });

      const updated = await service.updateMemory(
        TEST_USER_ID,
        created.id,
        { importance: "HIGH" },
      );

      expect(updated!.importance).toBe("HIGH");
    });

    it("should return null for non-existent memory", async () => {
      const updated = await service.updateMemory(
        TEST_USER_ID,
        "non-existent",
        { content: "Updated" },
      );
      expect(updated).toBeNull();
    });
  });

  describe("deleteMemory", () => {
    it("should delete a memory", async () => {
      const created = await service.createMemory({
        userId: TEST_USER_ID,
        type: "SESSION_NOTE",
        content: "Temporary note",
      });

      const deleted = await service.deleteMemory(TEST_USER_ID, created.id);
      expect(deleted).toBe(true);

      const found = await service.getMemory(TEST_USER_ID, created.id);
      expect(found).toBeNull();
    });

    it("should return false for non-existent memory", async () => {
      const deleted = await service.deleteMemory(
        TEST_USER_ID,
        "non-existent",
      );
      expect(deleted).toBe(false);
    });

    it("should not delete memory belonging to another user", async () => {
      const created = await service.createMemory({
        userId: TEST_USER_ID,
        type: "FACT",
        content: "Important fact",
      });

      const deleted = await service.deleteMemory(
        "other-user-id",
        created.id,
      );
      expect(deleted).toBe(false);

      const found = await service.getMemory(TEST_USER_ID, created.id);
      expect(found).toBeDefined();
    });
  });

  describe("retrieveRelevant", () => {
    it("should retrieve memories by similarity", async () => {
      await service.createMemory({
        userId: TEST_USER_ID,
        type: "USER_PREFERENCE",
        content: "User prefers TypeScript for all projects",
      });
      await service.createMemory({
        userId: TEST_USER_ID,
        type: "REPOSITORY_KNOWLEDGE",
        content: "This repository uses PostgreSQL as the database",
      });

      const results = await service.retrieveRelevant({
        userId: TEST_USER_ID,
        query: "What language does the user prefer?",
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.memory).toBeDefined();
      expect(results[0]!.similarity).toBeGreaterThanOrEqual(0);
    });

    it("should respect topK limit", async () => {
      for (let i = 0; i < 10; i++) {
        await service.createMemory({
          userId: TEST_USER_ID,
          type: "FACT",
          content: `Fact number ${i} about various topics`,
        });
      }

      const results = await service.retrieveRelevant({
        userId: TEST_USER_ID,
        query: "Tell me a fact",
        topK: 3,
      });

      expect(results.length).toBeLessThanOrEqual(3);
    });

    it("should filter by repository scope", async () => {
      await service.createMemory({
        userId: TEST_USER_ID,
        repositoryId: TEST_REPO_ID,
        type: "REPOSITORY_KNOWLEDGE",
        content: "This repo uses Express.js",
      });

      await service.createMemory({
        userId: TEST_USER_ID,
        type: "REPOSITORY_KNOWLEDGE",
        content: "This repo uses Fastify",
      });

      const results = await service.retrieveRelevant({
        userId: TEST_USER_ID,
        repositoryId: TEST_REPO_ID,
        query: "What framework does this repo use?",
      });

      const repoMemories = results.filter(
        (r) => r.memory.repositoryId === TEST_REPO_ID,
      );
      expect(repoMemories.length).toBeGreaterThan(0);
    });

    it("should not retrieve memories from other users", async () => {
      await service.createMemory({
        userId: TEST_USER_ID,
        type: "USER_PREFERENCE",
        content: "Private preference for user A",
      });

      const results = await service.retrieveRelevant({
        userId: "other-user-id",
        query: "What is the user preference?",
      });

      expect(results.length).toBe(0);
    });

    it("should filter by memory type", async () => {
      await service.createMemory({
        userId: TEST_USER_ID,
        type: "USER_PREFERENCE",
        content: "User likes VS Code",
      });
      await service.createMemory({
        userId: TEST_USER_ID,
        type: "FACT",
        content: "VS Code is an editor",
      });

      const results = await service.retrieveRelevant({
        userId: TEST_USER_ID,
        query: "editor preference",
        types: ["USER_PREFERENCE"],
      });

      expect(
        results.every((r) => r.memory.type === "USER_PREFERENCE"),
      ).toBe(true);
    });

    it("should return empty array when no memories exist", async () => {
      const results = await service.retrieveRelevant({
        userId: "user-with-no-memories",
        query: "anything",
      });

      expect(results).toEqual([]);
    });
  });

  describe("deduplication", () => {
    it("should not create duplicate memories with same content", async () => {
      await service.createMemory({
        userId: TEST_USER_ID,
        type: "USER_PREFERENCE",
        content: "User prefers dark mode",
      });

      await service.createMemory({
        userId: TEST_USER_ID,
        type: "USER_PREFERENCE",
        content: "User prefers dark mode",
      });

      const result = await service.listMemories(TEST_USER_ID);
      const darkModeMemories = result.memories.filter(
        (m) => m.content === "User prefers dark mode",
      );
      expect(darkModeMemories.length).toBe(1);
    });

    it("should allow same content for different users", async () => {
      await service.createMemory({
        userId: TEST_USER_ID,
        type: "USER_PREFERENCE",
        content: "Uses dark mode",
      });

      await service.createMemory({
        userId: "another-user-id",
        type: "USER_PREFERENCE",
        content: "Uses dark mode",
      });

      const result1 = await service.listMemories(TEST_USER_ID);
      const result2 = await service.listMemories("another-user-id");

      expect(result1.memories.length).toBeGreaterThanOrEqual(1);
      expect(result2.memories.length).toBeGreaterThanOrEqual(1);
    });
  });
});

describe("ContextBuilder", () => {
  it("should build context with system instructions and memories", async () => {
    const { ContextBuilder } = await import(
      "../../packages/runtime/src/state/context.js"
    );
    const builder = new ContextBuilder();

    const context = builder.build({
      systemInstructions: "You are a helpful coding assistant.",
      currentPrompt: "Help me with TypeScript",
      memories: [
        {
          memory: {
            id: "1",
            userId: "user1",
            repositoryId: null,
            sessionId: null,
            type: "USER_PREFERENCE",
            content: "User prefers TypeScript",
            normalizedContent: "user prefers typescript",
            importance: "HIGH",
            embedding: null,
            metadata: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          similarity: 0.85,
        },
      ],
    });

    expect(context.messages.length).toBe(2);
    expect(context.messages[0]!.role).toBe("system");
    expect(context.messages[0]!.content).toContain("You are a helpful coding assistant");
    expect(context.messages[0]!.content).toContain("User prefers TypeScript");
    expect(context.messages[1]!.role).toBe("user");
    expect(context.messages[1]!.content).toBe("Help me with TypeScript");
  });

  it("should include recent messages in context", async () => {
    const { ContextBuilder } = await import(
      "../../packages/runtime/src/state/context.js"
    );
    const builder = new ContextBuilder();

    const context = builder.build({
      systemInstructions: "You are an assistant.",
      currentPrompt: "Follow up question",
      recentMessages: [
        { role: "user", content: "Previous question" },
        { role: "assistant", content: "Previous answer" },
      ],
    });

    expect(context.messages.length).toBe(4);
    expect(context.messages[1]!.content).toBe("Previous question");
    expect(context.messages[2]!.content).toBe("Previous answer");
  });

  it("should include repository context", async () => {
    const { ContextBuilder } = await import(
      "../../packages/runtime/src/state/context.js"
    );
    const builder = new ContextBuilder();

    const context = builder.build({
      systemInstructions: "You are an assistant.",
      currentPrompt: "Question",
      repositoryContext: "This project uses Drizzle ORM",
    });

    expect(context.messages[0]!.content).toContain("Drizzle ORM");
  });

  it("should build context without memories", async () => {
    const { ContextBuilder } = await import(
      "../../packages/runtime/src/state/context.js"
    );
    const builder = new ContextBuilder();

    const context = builder.build({
      systemInstructions: "You are an assistant.",
      currentPrompt: "Hello",
    });

    expect(context.messages.length).toBe(2);
    expect(context.messages[0]!.role).toBe("system");
    expect(context.messages[1]!.role).toBe("user");
  });
});
