import { describe, it, expect, vi, beforeEach } from "vitest";
import { runLoop, MAX_ITERATIONS } from "../../packages/runtime/src/loop.js";
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
                execute: vi
                    .fn()
                    .mockResolvedValue(
                        "Error: branch 'feat/frontend-docker-prod' has no commits ahead of 'main' on GitHub. Complete the workflow first: implement the changes, stage, commit, and push 'feat/frontend-docker-prod', then call create_pull_request again.",
                    ),
            });
            const filesTool = createMockTool({
                name: "list_files",
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
