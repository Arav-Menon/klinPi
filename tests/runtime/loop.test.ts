import { describe, it, expect, vi, beforeEach } from "vitest";
import { runLoop } from "../../packages/runtime/src/loop.js";
import type {
    AgentTool,
    AgentEventPayload,
    LoopMessage,
    ModelFn,
    ModelResponse,
    ModelToolCall,
} from "../../packages/runtime/src/types.js";

function createMockTool(overrides?: Partial<AgentTool>): AgentTool {
    return {
        name: "test_tool",
        description: "A test tool",
        parameters: {
            type: "object",
            properties: {
                input: { type: "string" },
            },
            required: ["input"],
        },
        execute: vi.fn().mockResolvedValue("tool result"),
        ...overrides,
    };
}

function createMockToolCall(id: string, name: string, args: string): ModelToolCall {
    return {
        id,
        type: "function",
        function: { name, arguments: args },
    };
}

function createMockModelFn(
    responses: ModelResponse[],
): ModelFn {
    let callCount = 0;
    return vi.fn(async () => {
        const response = responses[callCount]!;
        callCount++;
        return response;
    });
}

const BASE_MESSAGES: LoopMessage[] = [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "Hello" },
];

describe("runLoop", () => {
    let events: AgentEventPayload[];

    beforeEach(() => {
        events = [];
    });

    it("should emit AGENT_MESSAGE when model returns text only", async () => {
        const modelFn = createMockModelFn([
            { content: "Hello! How can I help?", toolCalls: null, finishReason: "stop" },
        ]);

        await runLoop({
            messages: BASE_MESSAGES,
            tools: [],
            onEvent: (e) => events.push(e),
            modelFn,
        });

        expect(events).toHaveLength(1);
        expect(events[0]!.type).toBe("AGENT_MESSAGE");
        expect(events[0]!.content).toBe("Hello! How can I help?");
    });

    it("should execute one tool call and return final response", async () => {
        const tool = createMockTool();
        const modelFn = createMockModelFn([
            {
                content: null,
                toolCalls: [createMockToolCall("call_1", "test_tool", '{"input":"test"}')],
                finishReason: "tool_calls",
            },
            { content: "Done!", toolCalls: null, finishReason: "stop" },
        ]);

        await runLoop({
            messages: BASE_MESSAGES,
            tools: [tool],
            onEvent: (e) => events.push(e),
            modelFn,
        });

        expect(tool.execute).toHaveBeenCalledWith({ input: "test" }, "");

        const toolCallEvent = events.find((e) => e.type === "TOOL_CALL");
        expect(toolCallEvent).toBeDefined();
        expect(toolCallEvent!.toolCall!.name).toBe("test_tool");

        const toolResultEvent = events.find((e) => e.type === "TOOL_RESULT");
        expect(toolResultEvent).toBeDefined();
        expect(toolResultEvent!.toolResult!.output).toBe("tool result");

        const messageEvent = events.find((e) => e.type === "AGENT_MESSAGE");
        expect(messageEvent).toBeDefined();
        expect(messageEvent!.content).toBe("Done!");
    });

    it("should handle unknown tool correctly", async () => {
        const modelFn = createMockModelFn([
            {
                content: null,
                toolCalls: [createMockToolCall("call_1", "nonexistent_tool", "{}")],
                finishReason: "tool_calls",
            },
            { content: "Fixed it.", toolCalls: null, finishReason: "stop" },
        ]);

        await runLoop({
            messages: BASE_MESSAGES,
            tools: [],
            onEvent: (e) => events.push(e),
            modelFn,
        });

        const toolResultEvent = events.find((e) => e.type === "TOOL_RESULT");
        expect(toolResultEvent).toBeDefined();
        expect(toolResultEvent!.toolResult!.isError).toBe(true);
        expect(toolResultEvent!.toolResult!.output).toContain("Unknown tool");
    });

    it("should handle invalid JSON arguments", async () => {
        const tool = createMockTool();
        const modelFn = createMockModelFn([
            {
                content: null,
                toolCalls: [createMockToolCall("call_1", "test_tool", "not-json")],
                finishReason: "tool_calls",
            },
            { content: "OK", toolCalls: null, finishReason: "stop" },
        ]);

        await runLoop({
            messages: BASE_MESSAGES,
            tools: [tool],
            onEvent: (e) => events.push(e),
            modelFn,
        });

        expect(tool.execute).not.toHaveBeenCalled();

        const toolResultEvent = events.find((e) => e.type === "TOOL_RESULT");
        expect(toolResultEvent).toBeDefined();
        expect(toolResultEvent!.toolResult!.isError).toBe(true);
        expect(toolResultEvent!.toolResult!.output).toContain("Invalid JSON");
    });

    it("should handle tool execution failure", async () => {
        const tool = createMockTool({
            execute: vi.fn().mockRejectedValue(new Error("sandbox down")),
        });
        const modelFn = createMockModelFn([
            {
                content: null,
                toolCalls: [createMockToolCall("call_1", "test_tool", '{"input":"x"}')],
                finishReason: "tool_calls",
            },
            { content: "Let me try again.", toolCalls: null, finishReason: "stop" },
        ]);

        await runLoop({
            messages: BASE_MESSAGES,
            tools: [tool],
            onEvent: (e) => events.push(e),
            modelFn,
        });

        const toolResultEvent = events.find((e) => e.type === "TOOL_RESULT");
        expect(toolResultEvent).toBeDefined();
        expect(toolResultEvent!.toolResult!.output).toContain("sandbox down");
    });

    it("should handle multiple iterations", async () => {
        const tool1 = createMockTool({ name: "tool_a" });
        const tool2 = createMockTool({ name: "tool_b" });
        const modelFn = createMockModelFn([
            {
                content: null,
                toolCalls: [createMockToolCall("call_1", "tool_a", '{"input":"a"}')],
                finishReason: "tool_calls",
            },
            {
                content: null,
                toolCalls: [createMockToolCall("call_2", "tool_b", '{"input":"b"}')],
                finishReason: "tool_calls",
            },
            { content: "All done.", toolCalls: null, finishReason: "stop" },
        ]);

        await runLoop({
            messages: BASE_MESSAGES,
            tools: [tool1, tool2],
            onEvent: (e) => events.push(e),
            modelFn,
        });

        expect(tool1.execute).toHaveBeenCalledOnce();
        expect(tool2.execute).toHaveBeenCalledOnce();

        const messageEvents = events.filter((e) => e.type === "AGENT_MESSAGE");
        expect(messageEvents).toHaveLength(1);
        expect(messageEvents[0]!.content).toBe("All done.");
    });

    it("should emit AGENT_ERROR when max iterations reached", async () => {
        const tool = createMockTool();
        const modelFn = createMockModelFn(
            Array.from({ length: 11 }, () => ({
                content: null,
                toolCalls: [createMockToolCall("call_x", "test_tool", '{"input":"loop"}')],
                finishReason: "tool_calls" as const,
            })),
        );

        await runLoop({
            messages: BASE_MESSAGES,
            tools: [tool],
            onEvent: (e) => events.push(e),
            modelFn,
        });

        const errorEvent = events.find((e) => e.type === "AGENT_ERROR");
        expect(errorEvent).toBeDefined();
        expect(errorEvent!.content).toContain("Max iterations");
    });

    it("should pass correct messages to model", async () => {
        const modelFn = createMockModelFn([
            { content: "Hi!", toolCalls: null, finishReason: "stop" },
        ]);

        await runLoop({
            messages: BASE_MESSAGES,
            tools: [],
            onEvent: (e) => events.push(e),
            modelFn,
        });

        expect(modelFn).toHaveBeenCalledWith(
            BASE_MESSAGES,
            [],
        );
    });

    it("should convert tools to OpenRouter format", async () => {
        const tool = createMockTool();
        const modelFn = createMockModelFn([
            { content: "OK", toolCalls: null, finishReason: "stop" },
        ]);

        await runLoop({
            messages: BASE_MESSAGES,
            tools: [tool],
            onEvent: (e) => events.push(e),
            modelFn,
        });

        const callArgs = (modelFn as ReturnType<typeof vi.fn>).mock.calls[0];
        const toolsPassed = callArgs[1];

        expect(toolsPassed).toHaveLength(1);
        expect(toolsPassed[0]).toEqual({
            type: "function",
            function: {
                name: "test_tool",
                description: "A test tool",
                parameters: {
                    type: "object",
                    properties: { input: { type: "string" } },
                    required: ["input"],
                },
            },
        });
    });

    it("should append assistant and tool messages to conversation", async () => {
        const tool = createMockTool();
        const modelFn = createMockModelFn([
            {
                content: null,
                toolCalls: [createMockToolCall("call_1", "test_tool", '{"input":"x"}')],
                finishReason: "tool_calls",
            },
            { content: "Done", toolCalls: null, finishReason: "stop" },
        ]);

        await runLoop({
            messages: BASE_MESSAGES,
            tools: [tool],
            onEvent: (e) => events.push(e),
            modelFn,
        });

        const secondModelCall = (modelFn as ReturnType<typeof vi.fn>).mock.calls[1];
        const messagesPassed = secondModelCall[0];

        expect(messagesPassed).toHaveLength(4);
        expect(messagesPassed[2]).toEqual({
            role: "assistant",
            content: null,
            toolCalls: [createMockToolCall("call_1", "test_tool", '{"input":"x"}')],
        });
        expect(messagesPassed[3]).toEqual({
            role: "tool",
            toolCallId: "call_1",
            content: "tool result",
        });
    });

    it("should reuse initialSandboxId without creating a new sandbox", async () => {
        const tool = createMockTool();
        const modelFn = createMockModelFn([
            {
                content: null,
                toolCalls: [createMockToolCall("call_1", "test_tool", '{"input":"x"}')],
                finishReason: "tool_calls",
            },
            { content: "Done", toolCalls: null, finishReason: "stop" },
        ]);
        const createSandbox = vi.fn();

        await runLoop({
            messages: BASE_MESSAGES,
            tools: [tool],
            onEvent: (e) => events.push(e),
            modelFn,
            initialSandboxId: "sbx-existing",
            createSandbox,
        });

        expect(createSandbox).not.toHaveBeenCalled();
        expect(tool.execute).toHaveBeenCalledWith({ input: "x" }, "sbx-existing");

        const creatingEvent = events.find(
            (e) => e.type === "AGENT_STATUS" && e.content === "Creating sandbox...",
        );
        expect(creatingEvent).toBeUndefined();
    });

    it("should not create a sandbox for tools that do not require it", async () => {
        const tool = createMockTool();
        const modelFn = createMockModelFn([
            {
                content: null,
                toolCalls: [createMockToolCall("call_1", "test_tool", '{"input":"x"}')],
                finishReason: "tool_calls",
            },
            { content: "Done", toolCalls: null, finishReason: "stop" },
        ]);
        const createSandbox = vi.fn().mockResolvedValue("sbx-1");

        await runLoop({
            messages: BASE_MESSAGES,
            tools: [tool],
            onEvent: (e) => events.push(e),
            modelFn,
            createSandbox,
        });

        expect(createSandbox).not.toHaveBeenCalled();
        expect(tool.execute).toHaveBeenCalledWith({ input: "x" }, "");

        const creatingEvent = events.find(
            (e) => e.type === "AGENT_STATUS" && e.content === "Creating sandbox...",
        );
        expect(creatingEvent).toBeUndefined();
    });

    it("should create a sandbox when the tool requires it", async () => {
        const tool = createMockTool({ requiresSandbox: true });
        const modelFn = createMockModelFn([
            {
                content: null,
                toolCalls: [createMockToolCall("call_1", "test_tool", '{"input":"x"}')],
                finishReason: "tool_calls",
            },
            { content: "Done", toolCalls: null, finishReason: "stop" },
        ]);
        const createSandbox = vi.fn().mockResolvedValue("sbx-1");

        await runLoop({
            messages: BASE_MESSAGES,
            tools: [tool],
            onEvent: (e) => events.push(e),
            modelFn,
            createSandbox,
        });

        expect(createSandbox).toHaveBeenCalledTimes(1);
        expect(tool.execute).toHaveBeenCalledWith({ input: "x" }, "sbx-1");
    });
});
