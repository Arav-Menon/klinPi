import { describe, it, expect, beforeEach, vi } from "vitest";
import { Agent } from "../../packages/runtime/src/agent.js";
import { ContextBuilder } from "../../packages/runtime/src/state/context.js";
import type { MemoryService } from "../../packages/runtime/src/state/memory.js";
import type { MessageService } from "../../packages/runtime/src/state/message.js";
import type {
    AgentRunInput,
    AgentEventPayload,
    ModelFn,
} from "../../packages/runtime/src/types.js";

function createMockMemoryService(): MemoryService {
    return {
        retrieveRelevant: vi.fn().mockResolvedValue([]),
        createMemory: vi.fn(),
        getMemory: vi.fn(),
        listMemories: vi.fn(),
        updateMemory: vi.fn(),
        deleteMemory: vi.fn(),
    } as unknown as MemoryService;
}

function createMockMessageService(): MessageService {
    return {
        createMessage: vi.fn().mockResolvedValue({
            id: "msg-1",
            sessionId: "session-1",
            role: "USER",
            content: "test",
            metadata: null,
            createdAt: new Date(),
        }),
        getMessages: vi.fn().mockResolvedValue([]),
        getMessage: vi.fn(),
    } as unknown as MessageService;
}

function createMockModelFn(
    response?: { content?: string | null; toolCalls?: null; finishReason?: string },
): ModelFn {
    return vi.fn().mockResolvedValue({
        content: response?.content ?? "Hello!",
        toolCalls: response?.toolCalls ?? null,
        finishReason: response?.finishReason ?? "stop",
    });
}

const VALID_INPUT: AgentRunInput = {
    userId: "user-123",
    sessionId: "session-456",
    repositoryId: "repo-789",
    prompt: "Help me fix a bug",
};

describe("Agent", () => {
    let agent: Agent;
    let mockMemoryService: MemoryService;
    let mockMessageService: MessageService;
    let contextBuilder: ContextBuilder;
    let mockModelFn: ModelFn;

    beforeEach(() => {
        mockMemoryService = createMockMemoryService();
        mockMessageService = createMockMessageService();
        contextBuilder = new ContextBuilder();
        mockModelFn = createMockModelFn();

        agent = new Agent({
            contextBuilder,
            memoryService: mockMemoryService,
            messageService: mockMessageService,
            modelFn: mockModelFn,
        });
    });

    describe("input validation", () => {
        it("should reject missing userId", async () => {
            const events: AgentEventPayload[] = [];
            await agent.run(
                { ...VALID_INPUT, userId: "" },
                (e) => events.push(e),
            );
            expect(events.some((e) => e.type === "AGENT_ERROR")).toBe(true);
        });

        it("should reject missing sessionId", async () => {
            const events: AgentEventPayload[] = [];
            await agent.run(
                { ...VALID_INPUT, sessionId: "" },
                (e) => events.push(e),
            );
            expect(events.some((e) => e.type === "AGENT_ERROR")).toBe(true);
        });

        it("should reject missing prompt", async () => {
            const events: AgentEventPayload[] = [];
            await agent.run(
                { ...VALID_INPUT, prompt: "" },
                (e) => events.push(e),
            );
            expect(events.some((e) => e.type === "AGENT_ERROR")).toBe(true);
        });
    });

    describe("message persistence", () => {
        it("should persist user message to MessageService", async () => {
            const events: AgentEventPayload[] = [];
            await agent.run(VALID_INPUT, (e) => events.push(e));

            expect(mockMessageService.createMessage).toHaveBeenCalledWith({
                sessionId: VALID_INPUT.sessionId,
                role: "USER",
                content: VALID_INPUT.prompt,
            });
        });

        it("should load recent messages from MessageService", async () => {
            const events: AgentEventPayload[] = [];
            await agent.run(VALID_INPUT, (e) => events.push(e));

            expect(mockMessageService.getMessages).toHaveBeenCalledWith(
                VALID_INPUT.sessionId,
                { limit: 20 },
            );
        });
    });

    describe("memory retrieval", () => {
        it("should call memoryService with correct userId and repositoryId", async () => {
            const events: AgentEventPayload[] = [];
            await agent.run(VALID_INPUT, (e) => events.push(e));

            expect(mockMemoryService.retrieveRelevant).toHaveBeenCalledWith({
                userId: VALID_INPUT.userId,
                repositoryId: VALID_INPUT.repositoryId,
                query: VALID_INPUT.prompt,
            });
        });
    });

    describe("context building", () => {
        it("should build context with system instructions and prompt", async () => {
            const events: AgentEventPayload[] = [];
            await agent.run(VALID_INPUT, (e) => events.push(e));

            expect(events.some((e) => e.type === "AGENT_STATUS")).toBe(true);
        });
    });

    describe("error handling", () => {
        it("should emit AGENT_ERROR when model function throws", async () => {
            const failingModelFn = vi.fn().mockRejectedValue(new Error("Model API down"));
            const failingAgent = new Agent({
                contextBuilder,
                memoryService: mockMemoryService,
                messageService: mockMessageService,
                modelFn: failingModelFn,
            });

            const events: AgentEventPayload[] = [];
            await failingAgent.run(VALID_INPUT, (e) => events.push(e));

            const errorEvent = events.find((e) => e.type === "AGENT_ERROR");
            expect(errorEvent).toBeDefined();
            expect(errorEvent!.content).toContain("Model API down");
        });

        it("should emit AGENT_ERROR when memory service fails", async () => {
            (
                mockMemoryService.retrieveRelevant as ReturnType<typeof vi.fn>
            ).mockRejectedValue(new Error("DB connection failed"));

            const events: AgentEventPayload[] = [];
            await agent.run(VALID_INPUT, (e) => events.push(e));

            const errorEvent = events.find((e) => e.type === "AGENT_ERROR");
            expect(errorEvent).toBeDefined();
            expect(errorEvent!.content).toContain("DB connection failed");
        });
    });

    describe("run isolation", () => {
        it("should not share state between runs", async () => {
            const events1: AgentEventPayload[] = [];
            const events2: AgentEventPayload[] = [];

            await agent.run(
                { ...VALID_INPUT, sessionId: "session-A" },
                (e) => events1.push(e),
            );
            await agent.run(
                { ...VALID_INPUT, sessionId: "session-B" },
                (e) => events2.push(e),
            );

            expect(mockMessageService.createMessage).toHaveBeenCalledWith(
                expect.objectContaining({ sessionId: "session-A" }),
            );
            expect(mockMessageService.createMessage).toHaveBeenCalledWith(
                expect.objectContaining({ sessionId: "session-B" }),
            );
        });
    });

    describe("custom system instructions", () => {
        it("should use custom system instructions when provided", async () => {
            const customAgent = new Agent({
                contextBuilder,
                memoryService: mockMemoryService,
                messageService: mockMessageService,
                systemInstructions: "Custom instructions",
                modelFn: mockModelFn,
            });

            const events: AgentEventPayload[] = [];
            await customAgent.run(VALID_INPUT, (e) => events.push(e));

            expect(events.some((e) => e.type === "AGENT_COMPLETED")).toBe(true);
        });
    });
});
