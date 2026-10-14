import { describe, it, expect, beforeEach, vi } from "vitest";

const computeMocks = vi.hoisted(() => ({
    Sandbox: { connect: vi.fn() },
    createSandbox: vi.fn(),
    sandboxManger: { registerSbx: vi.fn(), connectSbx: vi.fn() },
    listDir: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
}));
vi.mock("@klinpi/compute", () => computeMocks);

const sandboxServiceMocks = vi.hoisted(() => ({
    refresh: vi.fn(),
    ensure: vi.fn(),
    prepareRepository: vi.fn(),
}));
vi.mock(
    "../../packages/runtime/src/sandbox/sessionSandboxService.js",
    () => ({ sessionSandboxService: sandboxServiceMocks }),
);

vi.mock(
    "../../packages/runtime/src/tools/github_tools/github_auth.js",
    () => ({
        tokenCacheKey: (userId: string) => `github:access-token:${userId}`,
        sanitize: (text: string) => text,
        resolveGitHubToken: vi.fn(async () => ({ token: "gho_test_token" })),
        resolveToolToken: vi.fn(async () => ({ token: "gho_test_token" })),
        invalidateGitHubToken: vi.fn(async () => {}),
    }),
);

const githubApiMocks = vi.hoisted(() => ({
    createIssue: vi.fn(async () => ({
        issueNumber: 10,
        url: "https://github.com/test-org/klinpi/issues/10",
        title: "Redesign UI",
        state: "open",
    })),
}));
vi.mock(
    "../../packages/runtime/src/tools/github_tools/github_api.js",
    async (importOriginal) => {
        const actual = await importOriginal<
            typeof import("../../packages/runtime/src/tools/github_tools/github_api.js")
        >();
        return { ...actual, createIssue: githubApiMocks.createIssue };
    },
);

import { Agent } from "../../packages/runtime/src/agent.js";
import { ContextBuilder } from "../../packages/runtime/src/state/context.js";
import { getTools } from "../../packages/runtime/src/tools/index.js";
import { createRunWorkflowState } from "../../packages/runtime/src/lib/workflowState.js";
import type { MemoryService } from "../../packages/runtime/src/state/memory.js";
import type { MessageService } from "../../packages/runtime/src/state/message.js";
import type {
    AgentEventPayload,
    AgentTool,
    LoopMessage,
    ModelFn,
    ModelResponse,
    ModelToolCall,
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

function scriptedModelFn(responses: ModelResponse[]): ModelFn {
    let callCount = 0;
    return vi.fn(async () => {
        const response = responses[callCount] ?? responses[responses.length - 1]!;
        callCount += 1;
        return response;
    }) as unknown as ModelFn;
}

function toolCall(name: string, args: Record<string, unknown>): ModelResponse {
    const call: ModelToolCall = {
        id: `call-${name}`,
        type: "function",
        function: { name, arguments: JSON.stringify(args) },
    };
    return { content: null, toolCalls: [call], finishReason: "tool_calls" };
}

function finalAnswer(content: string): ModelResponse {
    return { content, toolCalls: null, finishReason: "stop" };
}

async function runAgent(
    prompt: string,
    responses: ModelResponse[],
): Promise<{ events: AgentEventPayload[]; modelFn: ModelFn }> {
    const modelFn = scriptedModelFn(responses);
    const agent = new Agent({
        contextBuilder: new ContextBuilder(),
        memoryService: createMockMemoryService(),
        messageService: createMockMessageService(),
        modelFn,
    });

    const events: AgentEventPayload[] = [];
    await agent.run(
        {
            userId: "user-availability",
            sessionId: `session-availability-${crypto.randomUUID()}`,
            repositoryId: "",
            prompt,
        },
        (e) => events.push(e),
    );

    return { events, modelFn };
}

interface WireTool {
    function: { name: string; description: string };
}

function toolsSentToModel(modelFn: ModelFn): string[] {
    const calls = vi.mocked(modelFn).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const tools = calls[0]![1] as WireTool[];
    return tools.map((t) => t.function.name);
}

function systemMessageOf(modelFn: ModelFn): string {
    const calls = vi.mocked(modelFn).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const messages = calls[0]![0] as LoopMessage[];
    const system = messages.find((m) => m.role === "system");
    expect(system).toBeDefined();
    return (system as { content: string }).content;
}

function registeredToolInventory(system: string): string[] {
    const header = "Registered tools (authoritative list for this run):";
    const start = system.indexOf(header);
    expect(start).toBeGreaterThanOrEqual(0);
    const block = system.slice(start, system.indexOf("\n\n", start));
    const names = [...block.matchAll(/^- ([a-z_0-9]+):/gm)].map((m) => m[1]!);
    return names;
}

function executedToolNames(events: AgentEventPayload[]): string[] {
    return events
        .filter((e) => e.type === "TOOL_CALL")
        .map((e) => e.toolCall!.name);
}

describe("tool availability for agent runs", () => {
    beforeEach(() => {
        computeMocks.listDir.mockReset();
        computeMocks.readFile.mockReset();
        computeMocks.writeFile.mockReset();
        computeMocks.sandboxManger.connectSbx.mockReset();
        computeMocks.sandboxManger.connectSbx.mockResolvedValue({
            commands: {
                run: vi
                    .fn()
                    .mockResolvedValue({ exitCode: 0, stdout: "ok", stderr: "" }),
            },
        });
        sandboxServiceMocks.refresh.mockReset();
        sandboxServiceMocks.ensure.mockReset();
        sandboxServiceMocks.prepareRepository.mockReset();
        sandboxServiceMocks.refresh.mockResolvedValue("sbx-availability-1");
        githubApiMocks.createIssue.mockClear();
    });

    const ANALYSIS_PROMPT =
        "Can you deep dive into this repo and explain me the architecture of this repo?";

    const INVENTORY_PROMPT = "What tools are available?";

    describe("repository-analysis request", () => {
        it("receives the repository inspection tools in the model request", async () => {
            const { modelFn } = await runAgent(INVENTORY_PROMPT, [
                finalAnswer(
                    "The architecture is a gateway in front of a runtime with a shared database.",
                ),
            ]);

            const sent = toolsSentToModel(modelFn);
            expect(sent).toEqual(
                expect.arrayContaining(["list_files", "read_file"]),
            );
            // A question prompt is read-only: shell and mutation tools are
            // not offered.
            expect(sent).not.toContain("run_command");
            expect(sent).not.toContain("create_issue");
            expect(sent).not.toContain("edit_file");
        });

        it("describes those tools in the system message", async () => {
            const { modelFn } = await runAgent(INVENTORY_PROMPT, [
                finalAnswer("Done."),
            ]);

            const system = systemMessageOf(modelFn);
            expect(system).toContain("Registered tools");
            expect(system).toContain("- list_files:");
            expect(system).toContain("- read_file:");
            expect(system).not.toContain("- run_command:");
            expect(system).toContain("capability domains");
        });

        it("completes the run from a final answer without spurious nudges", async () => {
            const { events, modelFn } = await runAgent(INVENTORY_PROMPT, [
                finalAnswer("The architecture is gateway + runtime."),
            ]);

            expect(events.some((e) => e.type === "AGENT_COMPLETED")).toBe(true);
            expect(events.filter((e) => e.type === "AGENT_MESSAGE")).toHaveLength(1);
            expect(
                events.filter(
                    (e) =>
                        e.type === "AGENT_STATUS" &&
                        String(e.content).includes("continuing the run"),
                ),
            ).toHaveLength(0);
            expect(vi.mocked(modelFn)).toHaveBeenCalledTimes(1);
        });
    });

    describe("system-message inventory is generated from the registered tools", () => {
        it("matches the tool definitions sent to the model exactly", async () => {
            const { modelFn } = await runAgent(INVENTORY_PROMPT, [
                finalAnswer("Done."),
            ]);

            const sent = toolsSentToModel(modelFn);
            const inventory = registeredToolInventory(systemMessageOf(modelFn));
            expect(inventory.sort()).toEqual([...sent].sort());
        });

        it("offers a strict subset of the registered catalog for a read-only request", async () => {
            const { modelFn } = await runAgent(INVENTORY_PROMPT, [
                finalAnswer("Done."),
            ]);

            const registered = getTools({
                memoryService: createMockMemoryService(),
                userId: "user-availability",
                sessionId: "session-availability",
                repositoryId: null,
                workflow: createRunWorkflowState(),
            }).map((t) => t.name);

            const sent = toolsSentToModel(modelFn);
            const inventory = registeredToolInventory(systemMessageOf(modelFn));
            for (const name of sent) {
                expect(registered).toContain(name);
            }
            expect(inventory.sort()).toEqual([...sent].sort());
            // The read-only scope does not receive the whole catalog.
            expect(sent.length).toBeLessThan(registered.length);
        });

        it("scopes the catalog per request type", async () => {
            // An issue-creation request receives create_issue but not the
            // unrelated local-editing or other mutation tools.
            const { modelFn: issueModel } = await runAgent(
                "Create an issue about the UI",
                [finalAnswer("Done.")],
            );
            const issueTools = toolsSentToModel(issueModel);
            expect(issueTools).toContain("create_issue");
            expect(issueTools).toContain("list_files");
            expect(issueTools).not.toContain("close_issue");
            expect(issueTools).not.toContain("create_pull_request");
            expect(issueTools).not.toContain("edit_file");

            // A coding request receives the local tool groups but no
            // external GitHub mutations.
            const { modelFn: codingModel } = await runAgent(
                "Improve the Dockerfile for production builds.",
                [finalAnswer("Done.")],
            );
            const codingTools = toolsSentToModel(codingModel);
            for (const required of [
                "list_files",
                "read_file",
                "edit_file",
                "run_command",
                "git_status",
                "git_commit",
            ]) {
                expect(codingTools).toContain(required);
            }
            expect(codingTools).not.toContain("create_issue");
            expect(codingTools).not.toContain("create_pull_request");
        });
    });

    describe("GitHub issue request", () => {
        it("receives create_issue and completes it without repository inspection", async () => {
            const prompt = "Create an issue about redesigning the UI";
            const { events, modelFn } = await runAgent(prompt, [
                toolCall("create_issue", {
                    owner: "test-org",
                    repo: "klinpi",
                    title: "Redesign the UI",
                    body: "The UI needs a redesign.",
                }),
                finalAnswer(
                    "Created issue #10: Redesign the UI — https://github.com/test-org/klinpi/issues/10",
                ),
            ]);

            expect(toolsSentToModel(modelFn)).toContain("create_issue");
            expect(executedToolNames(events)).toEqual(["create_issue"]);
            expect(githubApiMocks.createIssue).toHaveBeenCalledTimes(1);

            // No repository inspection or local mutations were triggered.
            const executed = executedToolNames(events);
            for (const forbidden of [
                "list_files",
                "read_file",
                "edit_file",
                "run_command",
                "git_commit",
                "git_push",
                "create_pull_request",
            ]) {
                expect(executed).not.toContain(forbidden);
            }

            expect(events.filter((e) => e.type === "AGENT_MESSAGE")).toHaveLength(1);
            expect(events.some((e) => e.type === "AGENT_COMPLETED")).toBe(true);
            expect(
                events.filter(
                    (e) =>
                        e.type === "AGENT_STATUS" &&
                        String(e.content).includes("continuing the run"),
                ),
            ).toHaveLength(0);
        });
    });

    describe("file-reading request", () => {
        it("reads the file only, returns the result to the model, and stops", async () => {
            computeMocks.readFile.mockResolvedValue(
                "def handler():\n    return 42",
            );

            const { events, modelFn } = await runAgent(
                "Read main.py and summarize it.",
                [
                    toolCall("read_file", { path: "/workspace/main.py" }),
                    finalAnswer(
                        "main.py defines a handler that returns 42.",
                    ),
                ],
            );

            expect(executedToolNames(events)).toEqual(["read_file"]);
            expect(computeMocks.readFile).toHaveBeenCalledWith(
                "sbx-availability-1",
                "/workspace/main.py",
            );

            // Tool-result round-trip: the file contents reach the model as a
            // tool message before the final answer.
            const secondConversation = vi.mocked(modelFn).mock.calls[1]![0] as
                LoopMessage[];
            const toolMessage = secondConversation.find((m) => m.role === "tool");
            expect(toolMessage).toBeDefined();
            expect((toolMessage as { content: string }).content).toContain(
                "def handler():",
            );

            // No mutations or GitHub actions were executed.
            const executed = executedToolNames(events);
            for (const forbidden of [
                "edit_file",
                "create_issue",
                "close_issue",
                "git_commit",
                "git_push",
            ]) {
                expect(executed).not.toContain(forbidden);
            }
            expect(computeMocks.writeFile).not.toHaveBeenCalled();

            // The run finished cleanly after the requested operation.
            expect(
                events.filter((e) => e.type === "AGENT_MESSAGE"),
            ).toHaveLength(1);
            expect(events.some((e) => e.type === "AGENT_COMPLETED")).toBe(true);
            expect(vi.mocked(modelFn)).toHaveBeenCalledTimes(2);
        });
    });

    describe("coding request", () => {
        it("has repository inspection, modification, and validation tools available", async () => {
            const { modelFn } = await runAgent(
                "Improve the Dockerfile for production builds.",
                [finalAnswer("Done.")],
            );

            const sent = toolsSentToModel(modelFn);
            expect(sent).toEqual(
                expect.arrayContaining([
                    "list_files",
                    "read_file",
                    "edit_file",
                    "run_command",
                ]),
            );
        });

        it("inspects before modifying and validates with run_command", async () => {
            computeMocks.listDir.mockResolvedValue(
                "Dockerfile (400 bytes)\npackage.json (300 bytes)",
            );
            computeMocks.readFile.mockResolvedValue("FROM node:20");
            computeMocks.writeFile.mockResolvedValue(undefined);

            const { events } = await runAgent(
                "Improve the Dockerfile.",
                [
                    toolCall("list_files", { path: "/workspace" }),
                    toolCall("read_file", { path: "/workspace/Dockerfile" }),
                    toolCall("edit_file", {
                        path: "/workspace/Dockerfile",
                        content: "FROM node:20-slim",
                    }),
                    toolCall("run_command", { command: "docker build ." }),
                    finalAnswer("Dockerfile updated and validated."),
                ],
            );

            expect(executedToolNames(events)).toEqual([
                "list_files",
                "read_file",
                "edit_file",
                "run_command",
            ]);
            expect(events.some((e) => e.type === "AGENT_COMPLETED")).toBe(true);
        });
    });

    describe("missing repository context", () => {
        it("states plainly that no repository is linked instead of implying capabilities are missing", async () => {
            const { modelFn } = await runAgent(INVENTORY_PROMPT, [
                finalAnswer("No repository is linked to this session."),
            ]);

            const system = systemMessageOf(modelFn);
            expect(system).toContain("no repository is linked");
            expect(system).not.toContain("Repository context:");
            expect(system).toContain("Registered tools");
            // clone_repo is a workspace write — not offered for a question.
            expect(system).not.toContain("- clone_repo:");
        });

        it("offers the inspection tools when no repository is linked, and clone_repo for an explicit clone request", async () => {
            const { modelFn } = await runAgent(INVENTORY_PROMPT, [
                finalAnswer("Done."),
            ]);

            const sent = toolsSentToModel(modelFn);
            expect(sent).toEqual(
                expect.arrayContaining(["list_files", "read_file"]),
            );
            expect(sent).not.toContain("clone_repo");

            const { modelFn: cloneModel } = await runAgent(
                "clone https://github.com/test-org/klinpi and look around",
                [finalAnswer("Cloned.")],
            );
            expect(toolsSentToModel(cloneModel)).toContain("clone_repo");
        });
    });
});
