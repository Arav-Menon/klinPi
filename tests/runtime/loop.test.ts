import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    runLoop,
    MAX_ITERATIONS,
    MAX_CAPABILITY_CORRECTIONS,
    DEFAULT_TOOL_TIMEOUT_MS,
    isFalseCapabilityRefusal,
} from "../../packages/runtime/src/loop.js";
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

    it("should list the available tools when the model calls an unknown tool", async () => {
        const modelFn = createMockModelFn([
            {
                content: null,
                toolCalls: [
                    createMockToolCall(
                        "call_1",
                        "update_file",
                        '{"path":"/workspace/Dockerfile","content":"FROM node"}',
                    ),
                ],
                finishReason: "tool_calls",
            },
            { content: "Fixed it.", toolCalls: null, finishReason: "stop" },
            { content: "Fixed it.", toolCalls: null, finishReason: "stop" },
        ]);

        await runLoop({
            messages: BASE_MESSAGES,
            tools: [createMockTool()],
            onEvent: (e) => events.push(e),
            modelFn,
        });

        const toolResultEvent = events.find((e) => e.type === "TOOL_RESULT");
        expect(toolResultEvent).toBeDefined();
        expect(toolResultEvent!.toolResult!.isError).toBe(true);
        expect(toolResultEvent!.toolResult!.output).toBe(
            "Unknown tool: update_file. Available tools: test_tool",
        );
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
            { content: "The tool failed: sandbox down.", toolCalls: null, finishReason: "stop" },
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
            Array.from({ length: MAX_ITERATIONS + 1 }, () => ({
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

    it("should prepare an existing sandbox once for sandbox-dependent tools", async () => {
        const tool = createMockTool({ requiresSandbox: true });
        const modelFn = createMockModelFn([
            {
                content: null,
                toolCalls: [
                    createMockToolCall("call_1", "test_tool", '{"input":"a"}'),
                    createMockToolCall("call_2", "test_tool", '{"input":"b"}'),
                ],
                finishReason: "tool_calls",
            },
            { content: "Done", toolCalls: null, finishReason: "stop" },
        ]);
        const createSandbox = vi.fn();
        const prepareSandbox = vi.fn().mockResolvedValue(undefined);

        await runLoop({
            messages: BASE_MESSAGES,
            tools: [tool],
            onEvent: (e) => events.push(e),
            modelFn,
            initialSandboxId: "sbx-existing",
            createSandbox,
            prepareSandbox,
        });

        expect(prepareSandbox).toHaveBeenCalledTimes(1);
        expect(createSandbox).not.toHaveBeenCalled();
        expect(tool.execute).toHaveBeenCalledTimes(2);
        expect(tool.execute).toHaveBeenNthCalledWith(1, { input: "a" }, "sbx-existing");
        expect(tool.execute).toHaveBeenNthCalledWith(2, { input: "b" }, "sbx-existing");
    });

    it("should not prepare the sandbox for tools that do not require it", async () => {
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
        const prepareSandbox = vi.fn().mockResolvedValue(undefined);

        await runLoop({
            messages: BASE_MESSAGES,
            tools: [tool],
            onEvent: (e) => events.push(e),
            modelFn,
            initialSandboxId: "sbx-existing",
            createSandbox,
            prepareSandbox,
        });

        expect(prepareSandbox).not.toHaveBeenCalled();
        expect(createSandbox).not.toHaveBeenCalled();
    });

    it("should propagate prepareSandbox failures", async () => {
        const tool = createMockTool({ requiresSandbox: true });
        const modelFn = createMockModelFn([
            {
                content: null,
                toolCalls: [createMockToolCall("call_1", "test_tool", '{"input":"x"}')],
                finishReason: "tool_calls",
            },
        ]);
        const prepareSandbox = vi
            .fn()
            .mockRejectedValue(new Error("Clone failed: repository not found"));

        await expect(
            runLoop({
                messages: BASE_MESSAGES,
                tools: [tool],
                onEvent: (e) => events.push(e),
                modelFn,
                initialSandboxId: "sbx-existing",
                prepareSandbox,
            }),
        ).rejects.toThrow("Clone failed: repository not found");
    });

    describe("text tool-call recovery", () => {
        it("executes a tool call the model wrote as JSON text", async () => {
            const tool = createMockTool();
            const modelFn = createMockModelFn([
                {
                    content: '{"name":"test_tool","arguments":{"input":"x"}}',
                    toolCalls: null,
                    finishReason: "stop",
                },
                { content: "Done", toolCalls: null, finishReason: "stop" },
            ]);

            await runLoop({
                messages: BASE_MESSAGES,
                tools: [tool],
                onEvent: (e) => events.push(e),
                modelFn,
            });

            expect(tool.execute).toHaveBeenCalledWith({ input: "x" }, "");

            const toolCallEvent = events.find((e) => e.type === "TOOL_CALL");
            expect(toolCallEvent!.toolCall!.name).toBe("test_tool");

            const toolResultEvent = events.find((e) => e.type === "TOOL_RESULT");
            expect(toolResultEvent!.toolResult!.output).toBe("tool result");

            const messageEvents = events.filter((e) => e.type === "AGENT_MESSAGE");
            expect(messageEvents).toHaveLength(1);
            expect(messageEvents[0]!.content).toBe("Done");
        });

        it("appends the recovered call to the conversation as an assistant tool call", async () => {
            const tool = createMockTool();
            const modelFn = createMockModelFn([
                {
                    content: '{"name":"test_tool","arguments":{"input":"x"}}',
                    toolCalls: null,
                    finishReason: "stop",
                },
                { content: "Done", toolCalls: null, finishReason: "stop" },
            ]);

            await runLoop({
                messages: BASE_MESSAGES,
                tools: [tool],
                onEvent: (e) => events.push(e),
                modelFn,
            });

            const secondModelCall = (modelFn as ReturnType<typeof vi.fn>).mock
                .calls[1];
            const messagesPassed = secondModelCall[0];

            expect(messagesPassed).toHaveLength(4);
            expect(messagesPassed[2].role).toBe("assistant");
            expect(messagesPassed[2].content).toBeNull();
            expect(messagesPassed[2].toolCalls).toHaveLength(1);
            expect(messagesPassed[2].toolCalls[0].function.name).toBe("test_tool");
            expect(messagesPassed[3]).toEqual({
                role: "tool",
                toolCallId: messagesPassed[2].toolCalls[0].id,
                content: "tool result",
            });
        });

        it("keeps prose around a recovered tool call as the assistant content", async () => {
            const tool = createMockTool();
            const modelFn = createMockModelFn([
                {
                    content:
                        'Inspecting the repository first.\n{"name":"test_tool","arguments":{"input":"x"}}',
                    toolCalls: null,
                    finishReason: "stop",
                },
                { content: "Done", toolCalls: null, finishReason: "stop" },
            ]);

            await runLoop({
                messages: BASE_MESSAGES,
                tools: [tool],
                onEvent: (e) => events.push(e),
                modelFn,
            });

            expect(tool.execute).toHaveBeenCalledWith({ input: "x" }, "");

            const secondModelCall = (modelFn as ReturnType<typeof vi.fn>).mock
                .calls[1];
            const messagesPassed = secondModelCall[0];
            expect(messagesPassed[2].content).toBe(
                "Inspecting the repository first.",
            );
        });

        it("prefers native tool_calls when the provider returns both", async () => {
            const tool = createMockTool();
            const modelFn = createMockModelFn([
                {
                    content: '{"name":"test_tool","arguments":{"input":"from-text"}}',
                    toolCalls: [
                        createMockToolCall("call_1", "test_tool", '{"input":"native"}'),
                    ],
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

            expect(tool.execute).toHaveBeenCalledTimes(1);
            expect(tool.execute).toHaveBeenCalledWith({ input: "native" }, "");
        });

        it("turns JSON for an unregistered tool into unknown-tool feedback instead of a final answer", async () => {
            const tool = createMockTool();
            const modelFn = createMockModelFn([
                {
                    content: '{"name":"create_pull_request","arguments":{"head":"feat/x"}}',
                    toolCalls: null,
                    finishReason: "stop",
                },
                { content: "Fixed it.", toolCalls: null, finishReason: "stop" },
                { content: "Fixed it.", toolCalls: null, finishReason: "stop" },
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
            expect(toolResultEvent!.toolResult!.output).toContain(
                "Unknown tool: create_pull_request",
            );
            expect(toolResultEvent!.toolResult!.output).toContain(
                "Available tools: test_tool",
            );

            const messageEvent = events.find((e) => e.type === "AGENT_MESSAGE");
            expect(messageEvent!.content).toBe("Fixed it.");
        });

        it("keeps the loop running when a premature text create_pull_request call is rejected", async () => {
            const prTool = createMockTool({
                name: "create_pull_request",
                parameters: {
                    type: "object",
                    properties: {
                        title: { type: "string" },
                        head: { type: "string" },
                        base: { type: "string" },
                    },
                    required: ["title"],
                },
                execute: vi
                    .fn()
                    .mockResolvedValue(
                        "Error: branch 'feat/frontend-docker-prod' has no commits ahead of 'main' on GitHub. Complete the workflow first: implement the changes, stage, commit, and push 'feat/frontend-docker-prod', then call create_pull_request again.",
                    ),
            });
            const filesTool = createMockTool({
                name: "list_files",
                parameters: {
                    type: "object",
                    properties: { path: { type: "string" } },
                    required: ["path"],
                },
                execute: vi.fn().mockResolvedValue("/workspace/Dockerfile"),
            });
            const modelFn = createMockModelFn([
                {
                    content:
                        '{"name":"create_pull_request","arguments":{"title":"Improve frontend Dockerfile","head":"feat/frontend-docker-prod","base":"main"}}',
                    toolCalls: null,
                    finishReason: "stop",
                },
                {
                    content: null,
                    toolCalls: [
                        createMockToolCall("call_2", "list_files", '{"path":"/workspace"}'),
                    ],
                    finishReason: "tool_calls",
                },
                {
                    content: "The PR could not be created yet — implementing next.",
                    toolCalls: null,
                    finishReason: "stop",
                },
            ]);

            await runLoop({
                messages: BASE_MESSAGES,
                tools: [prTool, filesTool],
                onEvent: (e) => events.push(e),
                modelFn,
            });

            expect(prTool.execute).toHaveBeenCalledTimes(1);
            expect(filesTool.execute).toHaveBeenCalledWith({ path: "/workspace" }, "");

            const toolResults = events.filter((e) => e.type === "TOOL_RESULT");
            expect(toolResults).toHaveLength(2);
            expect(toolResults[0]!.toolResult!.output).toContain(
                "Complete the workflow first",
            );

            const messageEvents = events.filter((e) => e.type === "AGENT_MESSAGE");
            expect(messageEvents).toHaveLength(1);
            expect(messageEvents[0]!.content).toBe(
                "The PR could not be created yet — implementing next.",
            );
        });
    });
});

describe("runLoop premature-stop continuation", () => {
    let events: AgentEventPayload[];

    beforeEach(() => {
        events = [];
    });

    it("keeps the run alive when nudgeOnStop returns a corrective message", async () => {
        const tool = createMockTool();
        const modelFn = createMockModelFn([
            { content: "I am done.", toolCalls: null, finishReason: "stop" },
            { content: "Finished for real.", toolCalls: null, finishReason: "stop" },
        ]);
        const nudgeOnStop = vi
            .fn()
            .mockReturnValueOnce("Continue the task.")
            .mockReturnValue(null);

        await runLoop({
            messages: BASE_MESSAGES,
            tools: [tool],
            onEvent: (e) => events.push(e),
            modelFn,
            nudgeOnStop,
        });

        expect(nudgeOnStop).toHaveBeenNthCalledWith(1, "I am done.");
        expect(nudgeOnStop).toHaveBeenNthCalledWith(2, "Finished for real.");
        expect(modelFn).toHaveBeenCalledTimes(2);

        const messages = events.filter((e) => e.type === "AGENT_MESSAGE");
        expect(messages).toHaveLength(1);
        expect(messages[0]!.content).toBe("Finished for real.");

        expect(
            events.some(
                (e) =>
                    e.type === "AGENT_STATUS" &&
                    String(e.content).includes("incomplete"),
            ),
        ).toBe(true);

        const [conversation] = modelFn.mock.calls[1] as [LoopMessage[]];
        expect(conversation[conversation.length - 1]).toEqual({
            role: "user",
            content: "Continue the task.",
        });
    });

    it("surfaces the answer as final when nudgeOnStop returns null", async () => {
        const modelFn = createMockModelFn([
            { content: "Blocked, need input.", toolCalls: null, finishReason: "stop" },
        ]);
        const nudgeOnStop = vi.fn().mockReturnValue(null);

        await runLoop({
            messages: BASE_MESSAGES,
            tools: [],
            onEvent: (e) => events.push(e),
            modelFn,
            nudgeOnStop,
        });

        expect(modelFn).toHaveBeenCalledTimes(1);
        expect(nudgeOnStop).toHaveBeenCalledTimes(1);
        const messages = events.filter((e) => e.type === "AGENT_MESSAGE");
        expect(messages).toHaveLength(1);
        expect(messages[0]!.content).toBe("Blocked, need input.");
        expect(
            events.some((e) => e.type === "AGENT_STATUS"),
        ).toBe(false);
    });

    it("consults nudgeOnStop only at a stop, never between tool calls", async () => {
        const tool = createMockTool();
        const modelFn = createMockModelFn([
            {
                content: null,
                toolCalls: [createMockToolCall("call_1", "test_tool", '{"input":"x"}')],
                finishReason: "tool_calls",
            },
            { content: "All done.", toolCalls: null, finishReason: "stop" },
            { content: "Final answer.", toolCalls: null, finishReason: "stop" },
        ]);
        const nudgeOnStop = vi
            .fn()
            .mockReturnValueOnce("nope")
            .mockReturnValue(null);

        await runLoop({
            messages: BASE_MESSAGES,
            tools: [tool],
            onEvent: (e) => events.push(e),
            modelFn,
            nudgeOnStop,
        });

        expect(tool.execute).toHaveBeenCalledTimes(1);
        expect(modelFn).toHaveBeenCalledTimes(3);
        expect(nudgeOnStop).toHaveBeenCalledTimes(2);
        expect(nudgeOnStop).toHaveBeenNthCalledWith(1, "All done.");
        expect(nudgeOnStop).toHaveBeenNthCalledWith(2, "Final answer.");
    });

    it("still recovers a text tool call before considering a stop", async () => {
        const tool = createMockTool();
        const modelFn = createMockModelFn([
            {
                content: '```bash\ntest_tool({"input":"from-text"})\n```',
                toolCalls: null,
                finishReason: "stop",
            },
            { content: "Now done.", toolCalls: null, finishReason: "stop" },
            { content: "All finished.", toolCalls: null, finishReason: "stop" },
        ]);
        const nudgeOnStop = vi
            .fn()
            .mockReturnValueOnce("continue")
            .mockReturnValue(null);

        await runLoop({
            messages: BASE_MESSAGES,
            tools: [tool],
            onEvent: (e) => events.push(e),
            modelFn,
            nudgeOnStop,
        });

        expect(tool.execute).toHaveBeenCalledWith({ input: "from-text" }, "");
        expect(modelFn).toHaveBeenCalledTimes(3);
        expect(nudgeOnStop).toHaveBeenCalledTimes(2);
        expect(nudgeOnStop).toHaveBeenNthCalledWith(1, "Now done.");
        expect(nudgeOnStop).toHaveBeenNthCalledWith(2, "All finished.");

        const messages = events.filter((e) => e.type === "AGENT_MESSAGE");
        expect(messages).toHaveLength(1);
        expect(messages[0]!.content).toBe("All finished.");
    });
});

describe("isFalseCapabilityRefusal", () => {
    const OBSERVED_REFUSAL =
        "No tool exists to read repository files (e.g., readme.md). Available tools only handle GitHub issues/pull requests.";

    it("flags a false claim that no tool exists", () => {
        expect(isFalseCapabilityRefusal(OBSERVED_REFUSAL, true)).toBe(true);
    });

    it("flags other tool-availability denials", () => {
        expect(
            isFalseCapabilityRefusal(
                "I don't have a file tool to inspect the repository.",
                true,
            ),
        ).toBe(true);
        expect(
            isFalseCapabilityRefusal(
                "There is no repository reading tool available.",
                true,
            ),
        ).toBe(true);
        expect(
            isFalseCapabilityRefusal(
                "The registered tools only handle issue operations.",
                true,
            ),
        ).toBe(true);
    });

    // Verbatim (lightly truncated) refusals captured from production
    // Message rows — the guard must fire on what the model actually says,
    // not only on the first observed phrasing.
    it("flags every refusal phrasing observed in production transcripts", () => {
        const observed = [
            "The tools available to me are strictly for GitHub issue and pull request operations (e.g., creating, listing, updating issues, PRs). I do not have the capability to read files like `README.md` from a repository — this functionality is not supported by any of the provided tools.",
            "The tools provided do not include a function for reading files in a GitHub repository (like `readme.md`). All available functions are limited to GitHub issue/pull request operations (e.g., creating, listing, updating issues).",
            "The functions provided are exclusively for GitHub issue and pull request management (e.g., creating, listing, updating issues, handling PRs), but none of these tools can analyze or explain a repository's architecture.",
            "The functions available to me are limited to GitHub issue and pull request management (e.g., creating, listing, updating issues, creating PRs). I cannot deep-dive into repository architecture, inspect codebases, or analyze code structure.",
            "The assistant does not have access to read files like `readme.md` directly. The provided tools only support GitHub issue/pull request operations (create, list, get, update, close), but no file-reading capability is available.",
            // Live probe (Oct 13): markdown emphasis + plural must not dodge
            // the patterns after normalization.
            "The functions available for GitHub repository interaction (create_issue, list_issues, get_issue, update_issue, close_issue, create_pull_request) are designed for issue/pull request management and do **not** include any tools for reading or interacting with repository files (e.g., `readme.md`). Therefore, I cannot fulfill this request with the provided capabilities.",
            // UI run (Oct 13): model used the wrong argument name, got the
            // pre-dispatch validation error, then fell back to this claim.
            "The `read_file` tool is not available in this context. I can only interact with GitHub repositories using the following functions:\n\n- `create_issue` (create GitHub issues)\n- `list_issues` (list issues)\n- `get_issue` (retrieve specific issues)\n- `update_issue` (modify existing issues)\n- `close_issue` (close issues)\n- `create_pull_request` (create pull requests)\n\nWould you like to use any of these GitHub-specific functions instead?",
            // UI run (Oct 13): model answered a tool error with this —
            // reversed word order ("handle only") of the earlier phrasings.
            "This is **not related to GitHub functions** (the tools listed above handle only GitHub issues/PRs), so no function call is needed here.",
            // UI run (Oct 13): third variant — verb and "only" separated by
            // the object.
            "The error message indicates a file path issue that is unrelated to the GitHub functions listed (which handle issue/pr operations only). This error likely comes from a different context outside the scope of these GitHub tools.",
        ];
        for (const refusal of observed) {
            expect(
                isFalseCapabilityRefusal(refusal, true),
                `expected guard to flag: ${refusal.slice(0, 70)}...`,
            ).toBe(true);
        }
    });

    it("does not flag markdown-bold phrasing in legitimate answers", () => {
        expect(
            isFalseCapabilityRefusal(
                "The changes do **not** include any tests.",
                true,
            ),
        ).toBe(false);
    });

    it("does not flag permission or infrastructure statements", () => {
        expect(
            isFalseCapabilityRefusal(
                "GitHub authentication is not available in this context.",
                true,
            ),
        ).toBe(false);
        expect(
            isFalseCapabilityRefusal(
                "I can only use run_command with your approval.",
                true,
            ),
        ).toBe(false);
    });

    it("never flags ordinary conversational answers", () => {
        expect(
            isFalseCapabilityRefusal("Hello! How can I help you today?", true),
        ).toBe(false);
        expect(isFalseCapabilityRefusal("Here is the summary: ...", true)).toBe(
            false,
        );
        expect(isFalseCapabilityRefusal("", true)).toBe(false);
    });

    it("never flags genuine missing-context answers", () => {
        expect(
            isFalseCapabilityRefusal(
                "No repository is linked to this session — connect a repository first.",
                true,
            ),
        ).toBe(false);
        expect(
            isFalseCapabilityRefusal(
                "I can't read the files because no repository is connected.",
                true,
            ),
        ).toBe(false);
        expect(
            isFalseCapabilityRefusal("No sandbox is available right now.", true),
        ).toBe(false);
    });

    it("never flags when no tools are registered to falsify the claim", () => {
        expect(
            isFalseCapabilityRefusal(
                "No tool exists to read repository files.",
                false,
            ),
        ).toBe(false);
    });
});

describe("runLoop capability-refusal guard", () => {
    const REFUSAL =
        "No tool exists to read repository files. Available tools only handle GitHub issues/pull requests.";

    let events: AgentEventPayload[];

    beforeEach(() => {
        events = [];
    });

    function inspectionTools(): AgentTool[] {
        return [
            createMockTool({ name: "list_files" }),
            createMockTool({ name: "read_file" }),
            createMockTool({ name: "run_command" }),
        ];
    }

    it("corrects a false capability claim using the actual registered tools, then accepts the answer", async () => {
        const modelFn = createMockModelFn([
            { content: REFUSAL, toolCalls: null, finishReason: "stop" },
            {
                content: "The architecture is a gateway and a runtime.",
                toolCalls: null,
                finishReason: "stop",
            },
        ]);

        await runLoop({
            messages: BASE_MESSAGES,
            tools: inspectionTools(),
            onEvent: (e) => events.push(e),
            modelFn,
        });

        expect(modelFn).toHaveBeenCalledTimes(2);

        const correctionStatus = events.filter(
            (e) =>
                e.type === "AGENT_STATUS" &&
                String(e.content).includes("tool-availability"),
        );
        expect(correctionStatus).toHaveLength(1);

        // The corrective message is built from the registered tool names,
        // not from a hand-maintained list.
        const secondCallConversation = vi.mocked(modelFn).mock.calls[1]![0] as
            LoopMessage[];
        const corrective = [...secondCallConversation]
            .reverse()
            .find((m) => m.role === "user");
        expect(corrective).toBeDefined();
        expect(corrective!.role).toBe("user");
        const correctiveText = (corrective as { content: string }).content;
        expect(correctiveText).toContain("list_files");
        expect(correctiveText).toContain("read_file");
        expect(correctiveText).toContain("run_command");
        expect(correctiveText).toContain(
            "take no action the user did not ask for",
        );
        // The correction quotes the user's original request so the model
        // acts on that request instead of treating the meta-message as a
        // new instruction.
        expect(correctiveText).toContain(
            'The user\'s current request is: "Hello"',
        );

        const messages = events.filter((e) => e.type === "AGENT_MESSAGE");
        expect(messages).toHaveLength(1);
        expect(messages[0]!.content).toBe(
            "The architecture is a gateway and a runtime.",
        );
        expect(
            events.some((e) => e.type === "AGENT_COMPLETED" || e.type === "AGENT_ERROR"),
        ).toBe(false);
    });

    // Regression for the Oct 13 UI run: the model passed `file` instead of
    // `path`, the schema gate rejected it pre-dispatch, and the model then
    // fell back to "read_file is not available in this context". The guard
    // must correct that claim and the model must recover with the right
    // argument name — the run must not end on the false refusal.
    it("recovers when the model uses a wrong argument name then falsely denies the tool", async () => {
        const readExecute = vi.fn().mockResolvedValue("# Klinpi\nAgent platform.");
        const readFileTool: AgentTool = {
            name: "read_file",
            description: "Read a file",
            parameters: {
                type: "object",
                properties: { path: { type: "string" } },
                required: ["path"],
            },
            execute: readExecute,
        };
        const modelFn = createMockModelFn([
            {
                content: null,
                toolCalls: [
                    createMockToolCall("c1", "read_file", '{"file":"readme.md"}'),
                ],
                finishReason: "tool_calls",
            },
            {
                content:
                    "The `read_file` tool is not available in this context. I can only interact with GitHub repositories using the following functions:\n\n- `create_issue` (create GitHub issues)\n- `list_issues` (list issues)",
                toolCalls: null,
                finishReason: "stop",
            },
            {
                content: null,
                toolCalls: [
                    createMockToolCall(
                        "c2",
                        "read_file",
                        '{"path":"/workspace/README.md"}',
                    ),
                ],
                finishReason: "tool_calls",
            },
            {
                content: "The README explains Klinpi.",
                toolCalls: null,
                finishReason: "stop",
            },
        ]);

        await runLoop({
            messages: BASE_MESSAGES,
            tools: [readFileTool],
            onEvent: (e) => events.push(e),
            modelFn,
        });

        expect(modelFn).toHaveBeenCalledTimes(4);

        // First attempt was rejected pre-dispatch; the tool executed exactly
        // once, for the corrected call.
        expect(readExecute).toHaveBeenCalledTimes(1);
        expect(readExecute).toHaveBeenCalledWith(
            { path: "/workspace/README.md" },
            "",
        );

        const validationResults = events.filter(
            (e) =>
                e.type === "TOOL_RESULT" &&
                String(e.toolResult.output).includes(
                    "missing required field(s): path",
                ),
        );
        expect(validationResults).toHaveLength(1);
        expect(validationResults[0]!.toolResult!.isError).toBe(true);

        // The false refusal after the validation error triggers exactly one
        // capability correction, which quotes the original user request.
        const correctionStatus = events.filter(
            (e) =>
                e.type === "AGENT_STATUS" &&
                String(e.content).includes("tool-availability"),
        );
        expect(correctionStatus).toHaveLength(1);
        const correctionCall = vi.mocked(modelFn).mock.calls[2]![0] as
            LoopMessage[];
        const corrective = [...correctionCall]
            .reverse()
            .find((m) => m.role === "user");
        expect((corrective as { content: string }).content).toContain(
            "read_file",
        );

        // The run ends with the recovered answer, not the refusal.
        const messages = events.filter((e) => e.type === "AGENT_MESSAGE");
        expect(messages).toHaveLength(1);
        expect(messages[0]!.content).toBe("The README explains Klinpi.");
    });

    it("stops correcting after the bounded budget", async () => {
        const modelFn = createMockModelFn([
            { content: REFUSAL, toolCalls: null, finishReason: "stop" },
            { content: REFUSAL, toolCalls: null, finishReason: "stop" },
            { content: REFUSAL, toolCalls: null, finishReason: "stop" },
        ]);

        await runLoop({
            messages: BASE_MESSAGES,
            tools: inspectionTools(),
            onEvent: (e) => events.push(e),
            modelFn,
        });

        expect(modelFn).toHaveBeenCalledTimes(3);
        const corrections = events.filter(
            (e) =>
                e.type === "AGENT_STATUS" &&
                String(e.content).includes("tool-availability"),
        );
        expect(corrections).toHaveLength(MAX_CAPABILITY_CORRECTIONS);
        const messages = events.filter((e) => e.type === "AGENT_MESSAGE");
        expect(messages).toHaveLength(1);
    });

    it("never retries a genuine missing-context answer", async () => {
        const modelFn = createMockModelFn([
            {
                content:
                    "No repository is linked to this session — connect a repository first.",
                toolCalls: null,
                finishReason: "stop",
            },
        ]);

        await runLoop({
            messages: BASE_MESSAGES,
            tools: inspectionTools(),
            onEvent: (e) => events.push(e),
            modelFn,
        });

        expect(modelFn).toHaveBeenCalledTimes(1);
        expect(
            events.filter(
                (e) =>
                    e.type === "AGENT_STATUS" &&
                    String(e.content).includes("tool-availability"),
            ),
        ).toHaveLength(0);
        const messages = events.filter((e) => e.type === "AGENT_MESSAGE");
        expect(messages).toHaveLength(1);
        expect(messages[0]!.content).toContain("No repository is linked");
    });

    it("never retries ordinary conversational answers", async () => {
        const modelFn = createMockModelFn([
            {
                content: "Hello! Ask me anything about your project.",
                toolCalls: null,
                finishReason: "stop",
            },
        ]);

        await runLoop({
            messages: BASE_MESSAGES,
            tools: inspectionTools(),
            onEvent: (e) => events.push(e),
            modelFn,
        });

        expect(modelFn).toHaveBeenCalledTimes(1);
        expect(events.filter((e) => e.type === "AGENT_MESSAGE")).toHaveLength(1);
    });

    it("does not retry when no tools are registered", async () => {
        const modelFn = createMockModelFn([
            {
                content: "No tool exists to read repository files.",
                toolCalls: null,
                finishReason: "stop",
            },
        ]);

        await runLoop({
            messages: BASE_MESSAGES,
            tools: [],
            onEvent: (e) => events.push(e),
            modelFn,
        });

        expect(modelFn).toHaveBeenCalledTimes(1);
        expect(events.filter((e) => e.type === "AGENT_MESSAGE")).toHaveLength(1);
    });

    it("returns tool results to the model before the final answer", async () => {
        const tool = createMockTool({
            name: "read_file",
            parameters: {
                type: "object",
                properties: { path: { type: "string" } },
                required: ["path"],
            },
            execute: vi.fn().mockResolvedValue("FILE_CONTENTS = 42"),
        });
        const modelFn = createMockModelFn([
            {
                content: null,
                toolCalls: [
                    createMockToolCall("call_rf", "read_file", '{"path":"/workspace/main.py"}'),
                ],
                finishReason: "tool_calls",
            },
            { content: "The file defines 42.", toolCalls: null, finishReason: "stop" },
        ]);

        await runLoop({
            messages: BASE_MESSAGES,
            tools: [tool],
            onEvent: (e) => events.push(e),
            modelFn,
        });

        const secondConversation = vi.mocked(modelFn).mock.calls[1]![0] as
            LoopMessage[];
        const toolMessage = secondConversation.find((m) => m.role === "tool");
        expect(toolMessage).toBeDefined();
        expect((toolMessage as { content: string }).content).toBe(
            "FILE_CONTENTS = 42",
        );

        const messages = events.filter((e) => e.type === "AGENT_MESSAGE");
        expect(messages).toHaveLength(1);
        expect(messages[0]!.content).toBe("The file defines 42.");
    });
});

describe("tool execution timeout", () => {
    let events: AgentEventPayload[];

    beforeEach(() => {
        events = [];
    });

    it("abandons a hanging tool at its budget, reports a timeout, and continues the run", async () => {
        const hangingTool = createMockTool({
            name: "hanging_tool",
            timeoutMs: 50,
            execute: vi.fn(() => new Promise(() => {})),
        });
        const modelFn = createMockModelFn([
            {
                content: null,
                toolCalls: [
                    createMockToolCall("call_hang", "hanging_tool", '{"input":"x"}'),
                ],
                finishReason: "tool_calls",
            },
            {
                content: "Recovered after the tool timeout.",
                toolCalls: null,
                finishReason: "stop",
            },
            {
                content: "Recovered after the tool timeout.",
                toolCalls: null,
                finishReason: "stop",
            },
        ]);

        const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        const startedAt = Date.now();
        try {
            await runLoop({
                messages: BASE_MESSAGES,
                tools: [hangingTool],
                onEvent: (e) => events.push(e),
                modelFn,
                sessionId: "session-timeout",
            });
        } finally {
            logSpy.mockRestore();
        }
        const elapsed = Date.now() - startedAt;

        expect(elapsed).toBeGreaterThanOrEqual(50);
        expect(elapsed).toBeLessThan(5_000);

        const toolResult = events.find((e) => e.type === "TOOL_RESULT");
        expect(toolResult).toBeDefined();
        expect(toolResult!.toolResult!.isError).toBe(true);
        expect(toolResult!.toolResult!.output).toMatch(
            /timed out after 50ms: hanging_tool/,
        );

        // The run continues: the model is informed of the timeout on the
        // next round-trip, gets one retry nudge after its prose reply, and
        // can finish normally.
        expect(vi.mocked(modelFn)).toHaveBeenCalledTimes(3);
        const secondConversation = vi.mocked(modelFn).mock.calls[1]![0] as
            LoopMessage[];
        const toolMessage = secondConversation.find((m) => m.role === "tool");
        expect(toolMessage).toBeDefined();
        expect((toolMessage as { content: string }).content).toMatch(
            /timed out after 50ms/,
        );

        const messages = events.filter((e) => e.type === "AGENT_MESSAGE");
        expect(messages).toHaveLength(1);
        expect(messages[0]!.content).toBe("Recovered after the tool timeout.");
    });

    it("emits a phase-tagged timing line for the timed-out execution", async () => {
        const hangingTool = createMockTool({
            name: "hanging_tool",
            timeoutMs: 50,
            execute: vi.fn(() => new Promise(() => {})),
        });
        const modelFn = createMockModelFn([
            {
                content: null,
                toolCalls: [
                    createMockToolCall("call_hang", "hanging_tool", '{"input":"x"}'),
                ],
                finishReason: "tool_calls",
            },
            { content: "done", toolCalls: null, finishReason: "stop" },
            { content: "done", toolCalls: null, finishReason: "stop" },
        ]);

        const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        const timingLines: string[] = [];
        try {
            await runLoop({
                messages: BASE_MESSAGES,
                tools: [hangingTool],
                onEvent: (e) => events.push(e),
                modelFn,
                sessionId: "session-timing",
            });
            timingLines.push(
                ...logSpy.mock.calls.map((call) => String(call[0])),
            );
        } finally {
            logSpy.mockRestore();
        }
        const toolTiming = timingLines.find(
            (line) =>
                line.includes("phase=tool_execution") &&
                line.includes("tool=hanging_tool"),
        );
        expect(toolTiming).toBeDefined();
        expect(toolTiming).toContain("sessionId=session-timing");
        expect(toolTiming).toContain("callId=call_hang");
        expect(toolTiming).toContain("ok=false reason=timeout");
    });

    it("uses the documented default budget when a tool sets no timeout", () => {
        expect(DEFAULT_TOOL_TIMEOUT_MS).toBe(120_000);
        const noTimeoutTool = createMockTool({ timeoutMs: undefined });
        expect(noTimeoutTool.timeoutMs).toBeUndefined();
    });
});
