import { describe, it, expect, vi, beforeEach } from "vitest";
import { runLoop, validateToolArgs } from "../../packages/runtime/src/loop.js";
import { ContextBuilder } from "../../packages/runtime/src/state/context.js";
import { missingWorkflowSteps, createRunWorkflowState } from "../../packages/runtime/src/lib/workflowState.js";
import type {
    AgentTool,
    AgentEventPayload,
    LoopMessage,
    ModelFn,
    ModelResponse,
    ModelToolCall,
} from "../../packages/runtime/src/types.js";

function toolCall(id: string, name: string, args: string): ModelToolCall {
    return { id, type: "function", function: { name, arguments: args } };
}

function modelFn(responses: ModelResponse[]): ModelFn {
    let i = 0;
    return vi.fn(async () => responses[i++]!);
}

function issueTools(): { create: AgentTool; close: AgentTool } {
    const create: AgentTool = {
        name: "create_issue",
        description: "Create a GitHub issue",
        parameters: {
            type: "object",
            properties: {
                title: { type: "string" },
                body: { type: "string" },
            },
            required: ["title"],
        },
        execute: vi.fn().mockResolvedValue({
            issueNumber: 42,
            title: "Redesign the UI",
            state: "open",
            url: "https://github.com/acme/app/issues/42",
        }),
    };
    const close: AgentTool = {
        name: "close_issue",
        description: "Close a GitHub issue",
        parameters: {
            type: "object",
            properties: {
                issueNumber: { type: "number" },
            },
            required: ["issueNumber"],
        },
        execute: vi.fn().mockResolvedValue({ issueNumber: 42, state: "closed" }),
    };
    return { create, close };
}

const BASE: LoopMessage[] = [
    { role: "system", content: "You are Klinpi." },
    { role: "user", content: "Create an issue about redesigning the UI" },
];

function eventsOf(events: AgentEventPayload[], type: string): AgentEventPayload[] {
    return events.filter((e) => e.type === type);
}

describe("1. create-issue request calls create_issue and never close_issue", () => {
    let events: AgentEventPayload[];
    beforeEach(() => (events = []));

    it("executes only create_issue for a create-issue request", async () => {
        const { create, close } = issueTools();
        const fn = modelFn([
            {
                content: null,
                toolCalls: [toolCall("c1", "create_issue", '{"title":"Redesign the UI"}')],
                finishReason: "tool_calls",
            },
            {
                content: "Created issue #42: Redesign the UI",
                toolCalls: null,
                finishReason: "stop",
            },
        ]);

        await runLoop({
            messages: BASE,
            tools: [create, close],
            onEvent: (e) => events.push(e),
            modelFn: fn,
        });

        expect(create.execute).toHaveBeenCalledTimes(1);
        expect(close.execute).not.toHaveBeenCalled();
        const messages = eventsOf(events, "AGENT_MESSAGE");
        expect(messages).toHaveLength(1);
        expect(messages[0]!.content).toContain("#42");
    });
});

describe("2. successful issue creation returns its result and the run finishes", () => {
    it("delivers the created issue result and stops after one model round-trip", async () => {
        const events: AgentEventPayload[] = [];
        const { create, close } = issueTools();
        const fn = modelFn([
            {
                content: null,
                toolCalls: [toolCall("c1", "create_issue", '{"title":"Redesign the UI"}')],
                finishReason: "tool_calls",
            },
            {
                content: "Created issue #42: https://github.com/acme/app/issues/42",
                toolCalls: null,
                finishReason: "stop",
            },
        ]);

        await runLoop({
            messages: BASE,
            tools: [create, close],
            onEvent: (e) => events.push(e),
            modelFn: fn,
        });

        expect(vi.mocked(fn)).toHaveBeenCalledTimes(2);
        const messages = eventsOf(events, "AGENT_MESSAGE");
        expect(messages).toHaveLength(1);
        expect(messages[0]!.content).toContain("issues/42");
        expect(eventsOf(events, "AGENT_ERROR")).toHaveLength(0);
        expect(close.execute).not.toHaveBeenCalled();
    });
});

describe("3. close_issue without issueNumber is rejected safely", () => {
    it("does not execute close_issue and returns an error result instead", async () => {
        const events: AgentEventPayload[] = [];
        const { close } = issueTools();
        const fn = modelFn([
            {
                content: null,
                toolCalls: [toolCall("c1", "close_issue", "{}")],
                finishReason: "tool_calls",
            },
            {
                content: "Which issue should I close?",
                toolCalls: null,
                finishReason: "stop",
            },
            {
                content: "Which issue should I close?",
                toolCalls: null,
                finishReason: "stop",
            },
        ]);

        await runLoop({
            messages: BASE,
            tools: [close],
            onEvent: (e) => events.push(e),
            modelFn: fn,
        });

        expect(close.execute).not.toHaveBeenCalled();
        const results = eventsOf(events, "TOOL_RESULT");
        expect(results).toHaveLength(1);
        expect(results[0]!.toolResult!.isError).toBe(true);
        expect(results[0]!.toolResult!.output).toContain("issueNumber");
        expect(results[0]!.toolResult!.output).toContain("not executed");

        // The error is fed back to the model against the right call id.
        const secondConversation = vi.mocked(fn).mock.calls[1]![0] as LoopMessage[];
        const toolMessage = secondConversation.find((m) => m.role === "tool");
        expect(toolMessage).toBeDefined();
        expect(toolMessage!.toolCallId).toBe("c1");
        expect(toolMessage!.content).toContain("issueNumber");
    });

    it("rejects a wrong-typed issueNumber instead of coercing or inventing a value", async () => {
        const { close } = issueTools();
        const error = validateToolArgs(close, { issueNumber: "not-a-number" });
        expect(error).toContain("issueNumber");
        expect(error).toContain("number");
        expect(close.execute).not.toHaveBeenCalled();
    });
});

describe("4. tool-call arguments cannot leak between calls or runs", () => {
    it("passes each call its own arguments within one response", async () => {
        const first: AgentTool = {
            name: "test_tool",
            description: "t",
            parameters: {
                type: "object",
                properties: { input: { type: "string" } },
                required: ["input"],
            },
            execute: vi.fn().mockResolvedValue("ok"),
        };
        const second: AgentTool = {
            name: "other_tool",
            description: "o",
            parameters: {
                type: "object",
                properties: { input: { type: "string" } },
                required: ["input"],
            },
            execute: vi.fn().mockResolvedValue("ok"),
        };
        const fn = modelFn([
            {
                content: null,
                toolCalls: [
                    toolCall("c1", "test_tool", '{"input":"value-one"}'),
                    toolCall("c2", "other_tool", '{"input":"value-two"}'),
                ],
                finishReason: "tool_calls",
            },
            { content: "done", toolCalls: null, finishReason: "stop" },
        ]);

        await runLoop({
            messages: BASE,
            tools: [first, second],
            onEvent: () => {},
            modelFn: fn,
        });

        expect(first.execute).toHaveBeenCalledWith({ input: "value-one" }, "");
        expect(second.execute).toHaveBeenCalledWith({ input: "value-two" }, "");
    });

    it("starts every run with fresh conversation state", async () => {
        const tool: AgentTool = {
            name: "test_tool",
            description: "t",
            parameters: {
                type: "object",
                properties: { input: { type: "string" } },
                required: ["input"],
            },
            execute: vi.fn().mockResolvedValue("ok"),
        };
        const run1 = modelFn([
            {
                content: null,
                toolCalls: [toolCall("r1", "test_tool", '{"input":"run-one"}')],
                finishReason: "tool_calls",
            },
            { content: "first done", toolCalls: null, finishReason: "stop" },
        ]);
        await runLoop({
            messages: BASE,
            tools: [tool],
            onEvent: () => {},
            modelFn: run1,
        });

        const run2 = modelFn([
            {
                content: null,
                toolCalls: [toolCall("r2", "test_tool", '{"input":"run-two"}')],
                finishReason: "tool_calls",
            },
            { content: "second done", toolCalls: null, finishReason: "stop" },
        ]);
        await runLoop({
            messages: BASE,
            tools: [tool],
            onEvent: () => {},
            modelFn: run2,
        });

        const seen = vi.mocked(tool.execute).mock.calls.map((c) => c[0]);
        expect(seen).toEqual([{ input: "run-one" }, { input: "run-two" }]);
        // Each run got its own conversation — no messages carried over.
        const run1Conversation = vi.mocked(run1).mock.calls[0]![0] as LoopMessage[];
        const run2Conversation = vi.mocked(run2).mock.calls[0]![0] as LoopMessage[];
        expect(run1Conversation).not.toBe(run2Conversation);
        expect(run1Conversation).toHaveLength(run2Conversation.length);
    });
});

describe("5. tool results return to the correct conversation entry", () => {
    it("maps each result to its call id in the next model conversation", async () => {
        const first: AgentTool = {
            name: "test_tool",
            description: "t",
            parameters: {
                type: "object",
                properties: { input: { type: "string" } },
                required: ["input"],
            },
            execute: vi.fn().mockResolvedValue("result-one"),
        };
        const second: AgentTool = {
            name: "other_tool",
            description: "o",
            parameters: {
                type: "object",
                properties: { input: { type: "string" } },
                required: ["input"],
            },
            execute: vi.fn().mockResolvedValue("result-two"),
        };
        const fn = modelFn([
            {
                content: null,
                toolCalls: [
                    toolCall("call_1", "test_tool", '{"input":"a"}'),
                    toolCall("call_2", "other_tool", '{"input":"b"}'),
                ],
                finishReason: "tool_calls",
            },
            { content: "done", toolCalls: null, finishReason: "stop" },
        ]);

        await runLoop({
            messages: BASE,
            tools: [first, second],
            onEvent: () => {},
            modelFn: fn,
        });

        const conversation = vi.mocked(fn).mock.calls[1]![0] as LoopMessage[];
        const toolMessages = conversation.filter((m) => m.role === "tool");
        expect(toolMessages.map((m) => m.toolCallId)).toEqual(["call_1", "call_2"]);
        expect(toolMessages.map((m) => m.content)).toEqual([
            "result-one",
            "result-two",
        ]);
        // The assistant message that requested them preserves both calls.
        const assistant = conversation.find((m) => m.role === "assistant");
        expect(assistant!.toolCalls!.map((c) => c.id)).toEqual(["call_1", "call_2"]);
    });
});

describe("6. repository-reading request can reach the registered repository tools", () => {
    it("system message lists the inventory and read_file executes when called", async () => {
        const repoTools: AgentTool[] = [
            {
                name: "list_files",
                description: "List files in the repository.",
                parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
                execute: vi.fn().mockResolvedValue("README.md"),
            },
            {
                name: "read_file",
                description: "Read a repository file.",
                parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
                execute: vi.fn().mockResolvedValue("# Project"),
            },
            {
                name: "run_command",
                description: "Run a shell command.",
                parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
                execute: vi.fn().mockResolvedValue("ok"),
            },
        ];

        const context = new ContextBuilder().build({
            systemInstructions: "You are Klinpi.",
            currentPrompt: "Read this repo's README.md and explain it.",
            availableTools: repoTools,
        });
        const system = context.messages[0]!;
        expect(system.content).toContain("Registered tools");
        expect(system.content).toContain("list_files");
        expect(system.content).toContain("read_file");
        expect(system.content).toContain("run_command");

        const events: AgentEventPayload[] = [];
        const fn = modelFn([
            {
                content: null,
                toolCalls: [toolCall("c1", "read_file", '{"path":"README.md"}')],
                finishReason: "tool_calls",
            },
            { content: "It documents the project.", toolCalls: null, finishReason: "stop" },
        ]);
        await runLoop({
            messages: context.messages,
            tools: repoTools,
            onEvent: (e) => events.push(e),
            modelFn: fn,
        });
        expect(repoTools[1]!.execute).toHaveBeenCalledWith({ path: "README.md" }, "");
        expect(eventsOf(events, "AGENT_MESSAGE")).toHaveLength(1);
    });
});

describe("7. agent identity remains Klinpi", () => {
    it("system message starts with the Klinpi identity", () => {
        const context = new ContextBuilder().build({
            systemInstructions: "You are Klinpi, an autonomous software engineering agent.",
            currentPrompt: "hello",
        });
        expect(context.messages[0]!.content).toContain("You are Klinpi");
    });

    it("re-anchors identity and capability after contaminated history", () => {
        const tools: AgentTool[] = [
            { name: "read_file", description: "Read a file.", parameters: { type: "object", properties: {} }, execute: vi.fn() },
            { name: "create_issue", description: "Create an issue.", parameters: { type: "object", properties: {} }, execute: vi.fn() },
        ];
        const history = [
            { role: "user", content: "what all tools do you currently have?" },
            { role: "assistant", content: "I only have GitHub issue and pull request tools." },
            { role: "user", content: "what is your name?" },
            { role: "assistant", content: "I'm a GitHub assistant named CodeBot." },
        ];
        const context = new ContextBuilder().build({
            systemInstructions: "You are Klinpi.",
            currentPrompt: "Read the README",
            recentMessages: history,
            availableTools: tools,
        });

        const anchorIndex = context.messages.findIndex(
            (m) => m.role === "system" && m.content.includes("Reminder (authoritative for this run)"),
        );
        expect(anchorIndex).toBeGreaterThan(0);
        // Placed after all history, before the current prompt.
        expect(anchorIndex).toBe(history.length + 1);
        const anchor = context.messages[anchorIndex]!.content;
        expect(anchor).toContain("You are Klinpi");
        expect(anchor).toContain("read_file");
        expect(anchor).toContain("create_issue");
        expect(anchor).not.toContain("CodeBot");
        expect(context.messages[context.messages.length - 1]).toEqual({
            role: "user",
            content: "Read the README",
        });
    });

    it("no re-anchor when there is no history to correct", () => {
        const context = new ContextBuilder().build({
            systemInstructions: "You are Klinpi.",
            currentPrompt: "hello",
            availableTools: [{ name: "read_file", description: "Read a file." }],
        });
        expect(context.messages).toHaveLength(2);
        expect(
            context.messages.filter((m) => m.content.includes("Reminder")),
        ).toHaveLength(0);
    });
});

describe("8. ordinary conversational questions trigger no tools", () => {
    it("emits no tool calls when the model answers directly", async () => {
        const { create, close } = issueTools();
        const events: AgentEventPayload[] = [];
        const fn = modelFn([
            { content: "I'm Klinpi, ready to help.", toolCalls: null, finishReason: "stop" },
        ]);

        await runLoop({
            messages: BASE,
            tools: [create, close],
            onEvent: (e) => events.push(e),
            modelFn: fn,
        });

        expect(eventsOf(events, "TOOL_CALL")).toHaveLength(0);
        expect(eventsOf(events, "TOOL_RESULT")).toHaveLength(0);
        expect(create.execute).not.toHaveBeenCalled();
        expect(close.execute).not.toHaveBeenCalled();
        expect(eventsOf(events, "AGENT_MESSAGE")).toHaveLength(1);
        expect(vi.mocked(fn)).toHaveBeenCalledTimes(1);
    });
});

describe("9. a completed operation does not trigger unnecessary continuation", () => {
    it("accepts the final answer once the issue work is done", async () => {
        const { create, close } = issueTools();
        // Mirrors agent.ts: the nudge only fires for prompts with missing
        // workflow steps; a completed issue run has none.
        const workflow = createRunWorkflowState();
        create.execute = vi.fn().mockImplementation(async () => {
            workflow.issueOps += 1;
            return { issueNumber: 42, url: "https://github.com/acme/app/issues/42" };
        });
        const nudgeOnStop = vi.fn((content: string) => {
            const prompt = "Create an issue about redesigning the UI";
            const missing = missingWorkflowSteps(prompt, workflow);
            return missing.length > 0 ? "continue" : null;
        });

        const events: AgentEventPayload[] = [];
        const fn = modelFn([
            {
                content: null,
                toolCalls: [toolCall("c1", "create_issue", '{"title":"Redesign the UI"}')],
                finishReason: "tool_calls",
            },
            { content: "Created issue #42.", toolCalls: null, finishReason: "stop" },
        ]);

        await runLoop({
            messages: BASE,
            tools: [create, close],
            onEvent: (e) => events.push(e),
            modelFn: fn,
            nudgeOnStop,
        });

        expect(vi.mocked(fn)).toHaveBeenCalledTimes(2);
        expect(nudgeOnStop).toHaveBeenCalledTimes(1);
        expect(nudgeOnStop).toHaveReturnedWith(null);
        expect(eventsOf(events, "AGENT_MESSAGE")).toHaveLength(1);
        expect(
            events.filter(
                (e) =>
                    e.type === "AGENT_STATUS" &&
                    String(e.content).includes("continuing the run"),
            ),
        ).toHaveLength(0);
        expect(close.execute).not.toHaveBeenCalled();
    });
});

describe("10. genuine tool errors remain errors", () => {
    it("a rejected tool execution is reported with isError true, not success", async () => {
        const failing: AgentTool = {
            name: "test_tool",
            description: "t",
            parameters: { type: "object", properties: {}, required: [] },
            execute: vi.fn().mockRejectedValue(new Error("boom")),
        };
        const events: AgentEventPayload[] = [];
        const fn = modelFn([
            {
                content: null,
                toolCalls: [toolCall("c1", "test_tool", "{}")],
                finishReason: "tool_calls",
            },
            { content: "The tool failed with: boom", toolCalls: null, finishReason: "stop" },
            { content: "The tool failed with: boom", toolCalls: null, finishReason: "stop" },
        ]);

        await runLoop({
            messages: BASE,
            tools: [failing],
            onEvent: (e) => events.push(e),
            modelFn: fn,
        });

        const results = eventsOf(events, "TOOL_RESULT");
        expect(results).toHaveLength(1);
        expect(results[0]!.toolResult!.isError).toBe(true);
        expect(results[0]!.toolResult!.output).toContain("boom");

        const conversation = vi.mocked(fn).mock.calls[1]![0] as LoopMessage[];
        const toolMessage = conversation.find((m) => m.role === "tool")!;
        expect(toolMessage.content).toContain("boom");
    });

    it("an explicit Error: result string is passed through unchanged", async () => {
        const errorTool: AgentTool = {
            name: "test_tool",
            description: "t",
            parameters: { type: "object", properties: {}, required: [] },
            execute: vi.fn().mockResolvedValue("Error: something went wrong"),
        };
        const events: AgentEventPayload[] = [];
        const fn = modelFn([
            {
                content: null,
                toolCalls: [toolCall("c1", "test_tool", "{}")],
                finishReason: "tool_calls",
            },
            { content: "It failed.", toolCalls: null, finishReason: "stop" },
            { content: "It failed.", toolCalls: null, finishReason: "stop" },
        ]);

        await runLoop({
            messages: BASE,
            tools: [errorTool],
            onEvent: (e) => events.push(e),
            modelFn: fn,
        });

        const results = eventsOf(events, "TOOL_RESULT");
        expect(results[0]!.toolResult!.output).toBe(
            "Error: something went wrong",
        );
    });
});

describe("validateToolArgs", () => {
    it("accepts a complete, correctly typed argument object", () => {
        const { create, close } = issueTools();
        expect(validateToolArgs(create, { title: "Redesign the UI" })).toBeNull();
        expect(validateToolArgs(close, { issueNumber: 42 })).toBeNull();
    });

    it("lists every missing required field", () => {
        const tool: AgentTool = {
            name: "test_tool",
            description: "t",
            parameters: {
                type: "object",
                properties: { owner: { type: "string" }, repo: { type: "string" } },
                required: ["owner", "repo"],
            },
            execute: vi.fn(),
        };
        const error = validateToolArgs(tool, {});
        expect(error).toContain("owner");
        expect(error).toContain("repo");
    });

    it("checks declared types of provided optional fields", () => {
        const tool: AgentTool = {
            name: "test_tool",
            description: "t",
            parameters: {
                type: "object",
                properties: { count: { type: "integer" }, tags: { type: "array" } },
                required: [],
            },
            execute: vi.fn(),
        };
        expect(validateToolArgs(tool, { count: 3, tags: ["a"] })).toBeNull();
        expect(validateToolArgs(tool, { count: 1.5 })).toContain("integer");
        expect(validateToolArgs(tool, { tags: "not-an-array" })).toContain("array");
    });
});
