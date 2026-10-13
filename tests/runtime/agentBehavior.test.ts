import { describe, it, expect, vi, beforeEach } from "vitest";

const computeMocks = vi.hoisted(() => ({
    readFile: vi.fn(),
    listDir: vi.fn(),
    writeFile: vi.fn(),
}));
vi.mock("@klinpi/compute", () => computeMocks);

vi.mock("@klinpi/redis", () => ({
    cache: { getCache: vi.fn(), setCache: vi.fn(), deleteCache: vi.fn() },
}));
vi.mock("@klinpi/db", () => ({
    getDb: vi.fn(),
    schema: { oauthAccounts: {}, repositories: {} },
}));
vi.mock("drizzle-orm", () => ({ eq: vi.fn(), and: vi.fn() }));

import { runLoop } from "../../packages/runtime/src/loop.js";
import { createReadFileTool } from "../../packages/runtime/src/tools/file_tools/read_file.js";
import { createCreateIssueTool } from "../../packages/runtime/src/tools/github_tools/create_issue.js";
import { createCloseIssueTool } from "../../packages/runtime/src/tools/github_tools/close_issue.js";
import { createUpdateIssueTool } from "../../packages/runtime/src/tools/github_tools/update_issue.js";
import { createCreatePullRequestTool } from "../../packages/runtime/src/tools/github_tools/create_pull_request.js";
import { createListIssuesTool } from "../../packages/runtime/src/tools/github_tools/list_issues.js";
import { createGetIssueTool } from "../../packages/runtime/src/tools/github_tools/get_issue.js";
import { createRunWorkflowState } from "../../packages/runtime/src/lib/workflowState.js";
import type {
    AgentTool,
    AgentEventPayload,
    LoopMessage,
    ModelFn,
    ModelResponse,
    ModelToolCall,
    ToolContext,
} from "../../packages/runtime/src/types.js";

function toolCall(id: string, name: string, args: string): ModelToolCall {
    return { id, type: "function", function: { name, arguments: args } };
}

function modelFn(responses: ModelResponse[]): ModelFn {
    let i = 0;
    return vi.fn(async () => responses[i++]!);
}

function createContext(): ToolContext {
    return {
        memoryService: {} as ToolContext["memoryService"],
        userId: "user-1",
        sessionId: "session-1",
        repositoryId: null,
        workflow: createRunWorkflowState(),
    };
}

function mockTool(name: string, options?: Partial<AgentTool>): AgentTool {
    return {
        name,
        description: `${name} for tests`,
        parameters: {
            type: "object",
            properties: { title: { type: "string" } },
            required: ["title"],
        },
        execute: vi.fn().mockResolvedValue("ok"),
        ...options,
    };
}

const README_PROMPT = "Read this repo's readme.md and explain what Klinpi is.";

function githubMutationTools() {
    return {
        createIssue: mockTool("create_issue", { githubMutation: true }),
        closeIssue: mockTool("close_issue", { githubMutation: true }),
        updateIssue: mockTool("update_issue", { githubMutation: true }),
        createPr: mockTool("create_pull_request", { githubMutation: true }),
    };
}

function eventsOf(events: AgentEventPayload[], type: string): AgentEventPayload[] {
    return events.filter((e) => e.type === type);
}

beforeEach(() => {
    computeMocks.readFile.mockReset();
    computeMocks.listDir.mockReset();
    computeMocks.writeFile.mockReset();
});

describe("README casing recovery (incident reproduction)", () => {
    it("corrects the path after a failed read and answers without any GitHub mutation", async () => {
        computeMocks.readFile
            .mockRejectedValueOnce(new Error("ENOENT: no such file or directory"))
            .mockResolvedValueOnce("# Klinpi\nAn agent platform.");
        computeMocks.listDir.mockResolvedValue("README.md (120 bytes)\nAGENTS.md");

        const { createIssue, closeIssue, updateIssue, createPr } =
            githubMutationTools();
        const readTool = createReadFileTool(createContext());
        const events: AgentEventPayload[] = [];
        const fn = modelFn([
            {
                content: null,
                toolCalls: [toolCall("c1", "read_file", '{"path":"readme.md"}')],
                finishReason: "tool_calls",
            },
            {
                content: null,
                toolCalls: [toolCall("c2", "read_file", '{"path":"README.md"}')],
                finishReason: "tool_calls",
            },
            {
                content: "Klinpi is an autonomous agent platform.",
                toolCalls: null,
                finishReason: "stop",
            },
        ]);

        await runLoop({
            messages: [
                { role: "system", content: "You are Klinpi." },
                { role: "user", content: README_PROMPT },
            ],
            tools: [readTool, createIssue, closeIssue, updateIssue, createPr],
            onEvent: (e) => events.push(e),
            modelFn: fn,
            initialSandboxId: "sbx-1",
            sessionId: "session-readme",
        });

        expect(computeMocks.readFile).toHaveBeenNthCalledWith(
            1,
            "sbx-1",
            "/workspace/readme.md",
        );
        expect(computeMocks.readFile).toHaveBeenNthCalledWith(
            2,
            "sbx-1",
            "/workspace/README.md",
        );

        // The failed read fed the directory listing (with README.md) back to
        // the model, which recovered with the corrected path.
        const failedResult = eventsOf(events, "TOOL_RESULT")[0]!.toolResult!;
        expect(failedResult.isError).toBe(false);
        expect(failedResult.output).toContain("Error reading file");
        expect(failedResult.output).toContain("README.md");

        for (const mutation of [createIssue, closeIssue, updateIssue, createPr]) {
            expect(mutation.execute).not.toHaveBeenCalled();
        }
        const messages = eventsOf(events, "AGENT_MESSAGE");
        expect(messages).toHaveLength(1);
        expect(messages[0]!.content).toContain("Klinpi");
    });

    it("blocks create_issue the model emits after the failed read (the incident cascade)", async () => {
        computeMocks.readFile
            .mockRejectedValueOnce(new Error("ENOENT: no such file or directory"))
            .mockResolvedValueOnce("# Klinpi");
        computeMocks.listDir.mockResolvedValue("README.md (120 bytes)");

        const { createIssue, closeIssue, updateIssue, createPr } =
            githubMutationTools();
        const readTool = createReadFileTool(createContext());
        const events: AgentEventPayload[] = [];
        const fn = modelFn([
            {
                content: null,
                toolCalls: [toolCall("c1", "read_file", '{"path":"readme.md"}')],
                finishReason: "tool_calls",
            },
            // The incident: after the read failure the model chains an
            // unrequested GitHub mutation instead of correcting the path.
            {
                content: null,
                toolCalls: [
                    toolCall("c2", "create_issue", '{"title":"README.md not found"}'),
                ],
                finishReason: "tool_calls",
            },
            {
                content: null,
                toolCalls: [toolCall("c3", "read_file", '{"path":"README.md"}')],
                finishReason: "tool_calls",
            },
            {
                content: "Klinpi is an agent platform.",
                toolCalls: null,
                finishReason: "stop",
            },
        ]);

        await runLoop({
            messages: [
                { role: "system", content: "You are Klinpi." },
                { role: "user", content: README_PROMPT },
            ],
            tools: [readTool, createIssue, closeIssue, updateIssue, createPr],
            onEvent: (e) => events.push(e),
            modelFn: fn,
            initialSandboxId: "sbx-1",
            sessionId: "session-incident",
        });

        expect(createIssue.execute).not.toHaveBeenCalled();
        for (const other of [closeIssue, updateIssue, createPr]) {
            expect(other.execute).not.toHaveBeenCalled();
        }

        // The blocked call returned an actionable error to the model.
        const blocked = eventsOf(events, "TOOL_RESULT").find(
            (e) => e.toolResult!.toolCallId === "c2",
        );
        expect(blocked).toBeDefined();
        expect(blocked!.toolResult!.isError).toBe(true);
        expect(blocked!.toolResult!.output).toContain("Blocked");
        expect(blocked!.toolResult!.output).toContain("create_issue");

        // The run still recovered with the corrected path and finished.
        expect(computeMocks.readFile).toHaveBeenCalledWith(
            "sbx-1",
            "/workspace/README.md",
        );
        const messages = eventsOf(events, "AGENT_MESSAGE");
        expect(messages).toHaveLength(1);
        expect(messages[0]!.content).toContain("Klinpi");
    });

    it("blocks a prose-recovered GitHub mutation while the failure is unresolved", async () => {
        computeMocks.readFile.mockRejectedValueOnce(
            new Error("ENOENT: no such file or directory"),
        );
        computeMocks.listDir.mockResolvedValue("README.md (120 bytes)");

        const { createIssue } = githubMutationTools();
        const readTool = createReadFileTool(createContext());
        const events: AgentEventPayload[] = [];
        const fn = modelFn([
            {
                content: null,
                toolCalls: [toolCall("c1", "read_file", '{"path":"readme.md"}')],
                finishReason: "tool_calls",
            },
            // The model narrates the mutation as JSON text instead of a
            // structured call; the recovery channel picks it up — and the
            // gate must still block it while recovering.
            {
                content:
                    'Reporting this instead.\n{"name":"create_issue","arguments":{"title":"readme missing"}}',
                toolCalls: null,
                finishReason: "stop",
            },
            { content: "The README is missing.", toolCalls: null, finishReason: "stop" },
            { content: "The README is missing.", toolCalls: null, finishReason: "stop" },
        ]);

        await runLoop({
            messages: [
                { role: "system", content: "You are Klinpi." },
                { role: "user", content: README_PROMPT },
            ],
            tools: [readTool, createIssue],
            onEvent: (e) => events.push(e),
            modelFn: fn,
            initialSandboxId: "sbx-1",
            sessionId: "session-prose",
        });

        expect(createIssue.execute).not.toHaveBeenCalled();
        const blocked = eventsOf(events, "TOOL_RESULT").find((e) =>
            e.toolResult!.output.includes("Blocked"),
        );
        expect(blocked).toBeDefined();
    });
});

describe("create-only GitHub flow still works", () => {
    it("calls create_issue once and never close_issue/update_issue", async () => {
        const { createIssue, closeIssue, updateIssue } = githubMutationTools();
        const events: AgentEventPayload[] = [];
        const fn = modelFn([
            {
                content: null,
                toolCalls: [
                    toolCall("c1", "create_issue", '{"title":"Redesign the UI"}'),
                ],
                finishReason: "tool_calls",
            },
            {
                content: "Created issue #42: Redesign the UI",
                toolCalls: null,
                finishReason: "stop",
            },
        ]);

        await runLoop({
            messages: [
                { role: "system", content: "You are Klinpi." },
                { role: "user", content: "Create an issue about redesigning the UI" },
            ],
            tools: [createIssue, closeIssue, updateIssue],
            onEvent: (e) => events.push(e),
            modelFn: fn,
        });

        expect(createIssue.execute).toHaveBeenCalledTimes(1);
        expect(closeIssue.execute).not.toHaveBeenCalled();
        expect(updateIssue.execute).not.toHaveBeenCalled();
        const messages = eventsOf(events, "AGENT_MESSAGE");
        expect(messages).toHaveLength(1);
        expect(messages[0]!.content).toContain("#42");
    });

    it("allows create_pull_request in a clean multi-step run (no failure to recover from)", async () => {
        const order: string[] = [];
        const tools: AgentTool[] = [
            mockTool("edit_file", {
                parameters: {
                    type: "object",
                    properties: { path: { type: "string" } },
                    required: ["path"],
                },
                execute: vi.fn(async () => {
                    order.push("edit_file");
                    return "ok";
                }),
            }),
            mockTool("git_stage", {
                parameters: { type: "object", properties: {}, required: [] },
                execute: vi.fn(async () => {
                    order.push("git_stage");
                    return "ok";
                }),
            }),
            mockTool("git_push", {
                parameters: { type: "object", properties: {}, required: [] },
                execute: vi.fn(async () => {
                    order.push("git_push");
                    return "ok";
                }),
            }),
            mockTool("create_pull_request", {
                githubMutation: true,
                parameters: { type: "object", properties: {}, required: [] },
                execute: vi.fn(async () => {
                    order.push("create_pull_request");
                    return { url: "https://github.com/acme/app/pull/7" };
                }),
            }),
        ];
        const events: AgentEventPayload[] = [];
        const fn = modelFn([
            {
                content: null,
                toolCalls: [toolCall("c1", "edit_file", '{"path":"/workspace/a.ts"}')],
                finishReason: "tool_calls",
            },
            {
                content: null,
                toolCalls: [toolCall("c2", "git_stage", "{}")],
                finishReason: "tool_calls",
            },
            {
                content: null,
                toolCalls: [toolCall("c3", "git_push", "{}")],
                finishReason: "tool_calls",
            },
            {
                content: null,
                toolCalls: [toolCall("c4", "create_pull_request", "{}")],
                finishReason: "tool_calls",
            },
            {
                content: "Opened PR #7.",
                toolCalls: null,
                finishReason: "stop",
            },
        ]);

        await runLoop({
            messages: [
                { role: "system", content: "You are Klinpi." },
                {
                    role: "user",
                    content: "Fix the bug in a.ts and open a pull request",
                },
            ],
            tools,
            onEvent: (e) => events.push(e),
            modelFn: fn,
        });

        expect(order).toEqual([
            "edit_file",
            "git_stage",
            "git_push",
            "create_pull_request",
        ]);
        expect(eventsOf(events, "AGENT_MESSAGE")).toHaveLength(1);
    });
});

describe("failed tool calls are never treated as completion", () => {
    it("feeds the failure back, nudges a retry, and completes only after success", async () => {
        const failingThenFixed = mockTool("test_tool", {
            execute: vi
                .fn()
                .mockResolvedValueOnce("Error: first call is broken")
                .mockResolvedValueOnce("fixed result"),
        });
        const events: AgentEventPayload[] = [];
        const fn = modelFn([
            {
                content: null,
                toolCalls: [toolCall("c1", "test_tool", '{"title":"x"}')],
                finishReason: "tool_calls",
            },
            // Model gives up in prose after the failure.
            { content: "It failed, sorry.", toolCalls: null, finishReason: "stop" },
            {
                content: null,
                toolCalls: [toolCall("c2", "test_tool", '{"title":"y"}')],
                finishReason: "tool_calls",
            },
            { content: "Done.", toolCalls: null, finishReason: "stop" },
        ]);

        await runLoop({
            messages: [
                { role: "system", content: "You are Klinpi." },
                { role: "user", content: "Run the test tool" },
            ],
            tools: [failingThenFixed],
            onEvent: (e) => events.push(e),
            modelFn: fn,
        });

        expect(vi.mocked(fn)).toHaveBeenCalledTimes(4);
        expect(failingThenFixed.execute).toHaveBeenCalledTimes(2);
        expect(eventsOf(events, "AGENT_STATUS").length).toBeGreaterThanOrEqual(1);
        const messages = eventsOf(events, "AGENT_MESSAGE");
        expect(messages).toHaveLength(1);
        expect(messages[0]!.content).toBe("Done.");

        // The retry nudge names the failed tool and forbids unrelated actions.
        const nudged = vi.mocked(fn).mock.calls[2]![0] as LoopMessage[];
        const nudge = nudged.find(
            (m) => m.role === "user" && String(m.content).includes("failed"),
        );
        expect(nudge).toBeDefined();
        expect(String(nudge!.content)).toContain("test_tool");
        expect(String(nudge!.content)).toContain("never by switching");
    });

    it("passes the failure result to the model against the failed call id", async () => {
        const failing = mockTool("test_tool", {
            execute: vi.fn().mockResolvedValue("Error: boom"),
        });
        const fn = modelFn([
            {
                content: null,
                toolCalls: [toolCall("c1", "test_tool", '{"title":"x"}')],
                finishReason: "tool_calls",
            },
            { content: "It failed with boom.", toolCalls: null, finishReason: "stop" },
            { content: "It failed with boom.", toolCalls: null, finishReason: "stop" },
        ]);

        await runLoop({
            messages: [
                { role: "system", content: "You are Klinpi." },
                { role: "user", content: "Run the test tool" },
            ],
            tools: [failing],
            onEvent: () => {},
            modelFn: fn,
        });

        const conversation = vi.mocked(fn).mock.calls[1]![0] as LoopMessage[];
        const toolMessage = conversation.find((m) => m.role === "tool");
        expect(toolMessage).toBeDefined();
        expect(toolMessage!.toolCallId).toBe("c1");
        expect(String(toolMessage!.content)).toContain("boom");
    });
});

describe("read-only task stops after its one tool call", () => {
    it("executes read_file once, then accepts the explanation as the final answer", async () => {
        computeMocks.readFile.mockResolvedValueOnce("# Klinpi\nAgent platform.");
        const readTool = createReadFileTool(createContext());
        const events: AgentEventPayload[] = [];
        const fn = modelFn([
            {
                content: null,
                toolCalls: [toolCall("c1", "read_file", '{"path":"README.md"}')],
                finishReason: "tool_calls",
            },
            {
                content: "Klinpi is an autonomous agent platform.",
                toolCalls: null,
                finishReason: "stop",
            },
        ]);

        await runLoop({
            messages: [
                { role: "system", content: "You are Klinpi." },
                { role: "user", content: "Explain this repo's README" },
            ],
            tools: [readTool],
            onEvent: (e) => events.push(e),
            modelFn: fn,
            initialSandboxId: "sbx-1",
        });

        expect(vi.mocked(fn)).toHaveBeenCalledTimes(2);
        expect(computeMocks.readFile).toHaveBeenCalledTimes(1);
        expect(eventsOf(events, "TOOL_CALL")).toHaveLength(1);
        expect(eventsOf(events, "AGENT_MESSAGE")).toHaveLength(1);
    });
});

describe("stale tool calls cannot execute in later iterations", () => {
    it("does not re-execute a tool call when the next response is prose-only", async () => {
        const tool = mockTool("test_tool");
        const events: AgentEventPayload[] = [];
        const fn = modelFn([
            {
                content: null,
                toolCalls: [toolCall("c1", "test_tool", '{"title":"x"}')],
                finishReason: "tool_calls",
            },
            {
                // Prose that merely MENTIONS a registered tool name must not
                // trigger execution.
                content: "I used test_tool earlier and it returned ok.",
                toolCalls: null,
                finishReason: "stop",
            },
        ]);

        await runLoop({
            messages: [
                { role: "system", content: "You are Klinpi." },
                { role: "user", content: "Run the test tool" },
            ],
            tools: [tool],
            onEvent: (e) => events.push(e),
            modelFn: fn,
        });

        expect(tool.execute).toHaveBeenCalledTimes(1);
        expect(eventsOf(events, "TOOL_CALL")).toHaveLength(1);
        expect(eventsOf(events, "AGENT_MESSAGE")).toHaveLength(1);
    });
});

describe("call/result association", () => {
    it("maps each result to its call id in the next conversation", async () => {
        const first = mockTool("test_tool", {
            execute: vi.fn().mockResolvedValue("result-one"),
        });
        const second = mockTool("other_tool", {
            execute: vi.fn().mockResolvedValue("result-two"),
        });
        const fn = modelFn([
            {
                content: null,
                toolCalls: [
                    toolCall("call_1", "test_tool", '{"title":"a"}'),
                    toolCall("call_2", "other_tool", '{"title":"b"}'),
                ],
                finishReason: "tool_calls",
            },
            { content: "done", toolCalls: null, finishReason: "stop" },
        ]);

        await runLoop({
            messages: [
                { role: "system", content: "You are Klinpi." },
                { role: "user", content: "Run both tools" },
            ],
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
    });
});

describe("registry wiring and attribution logging", () => {
    it("marks the real GitHub mutation tools with githubMutation", () => {
        const context = createContext();
        expect(createCreateIssueTool(context).githubMutation).toBe(true);
        expect(createCloseIssueTool(context).githubMutation).toBe(true);
        expect(createUpdateIssueTool(context).githubMutation).toBe(true);
        expect(createCreatePullRequestTool(context).githubMutation).toBe(true);
        // Read-only issue tools must NOT be gated.
        expect(createListIssuesTool(context).githubMutation).toBeUndefined();
        expect(createGetIssueTool(context).githubMutation).toBeUndefined();
    });

    it("logs model-returned call ids and names per iteration", async () => {
        const tool = mockTool("test_tool");
        const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        try {
            const fn = modelFn([
                {
                    content: null,
                    toolCalls: [toolCall("c1", "test_tool", '{"title":"x"}')],
                    finishReason: "tool_calls",
                },
                { content: "done", toolCalls: null, finishReason: "stop" },
            ]);

            await runLoop({
                messages: [
                    { role: "system", content: "You are Klinpi." },
                    { role: "user", content: "Run the test tool" },
                ],
                tools: [tool],
                onEvent: () => {},
                modelFn: fn,
                sessionId: "session-log",
            });

            const lines = logSpy.mock.calls.map((call) => String(call[0]));
            const attribution = lines.find((line) =>
                line.includes("[AgentLoop] iteration=0"),
            );
            expect(attribution).toBeDefined();
            expect(attribution).toContain("model_calls=[c1:test_tool]");
        } finally {
            logSpy.mockRestore();
        }
    });
});
