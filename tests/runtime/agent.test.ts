import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getDb, schema } from "@klinpi/db";
import { eq } from "drizzle-orm";
import { Agent } from "../../packages/runtime/src/agent.js";

const computeMocks = vi.hoisted(() => ({
    connect: vi.fn(),
    create: vi.fn(),
    register: vi.fn(),
}));

vi.mock("@klinpi/compute", () => ({
    Sandbox: { connect: computeMocks.connect },
    createSandbox: computeMocks.create,
    sandboxManger: { registerSbx: computeMocks.register },
}));

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

    describe("initial prompt dedup (gateway-persisted first message)", () => {
        it("skips persisting the prompt when history already ends with it", async () => {
            (mockMessageService.getMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
                {
                    id: "msg-gateway",
                    sessionId: VALID_INPUT.sessionId,
                    role: "USER",
                    content: VALID_INPUT.prompt,
                    metadata: null,
                    createdAt: new Date(),
                },
            ]);

            const events: AgentEventPayload[] = [];
            await agent.run(VALID_INPUT, (e) => events.push(e));

            const userWrites = (
                mockMessageService.createMessage as ReturnType<typeof vi.fn>
            ).mock.calls.filter((call) => (call[0] as { role: string }).role === "USER");
            expect(userWrites).toHaveLength(0);
            expect(events.some((e) => e.type === "AGENT_COMPLETED")).toBe(true);
        });

        it("persists the prompt when history ends with a different message", async () => {
            (mockMessageService.getMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
                {
                    id: "msg-earlier-user",
                    sessionId: VALID_INPUT.sessionId,
                    role: "USER",
                    content: "an earlier prompt",
                    metadata: null,
                    createdAt: new Date(),
                },
                {
                    id: "msg-earlier-assistant",
                    sessionId: VALID_INPUT.sessionId,
                    role: "ASSISTANT",
                    content: "an earlier answer",
                    metadata: null,
                    createdAt: new Date(),
                },
            ]);

            const events: AgentEventPayload[] = [];
            await agent.run(VALID_INPUT, (e) => events.push(e));

            expect(mockMessageService.createMessage).toHaveBeenCalledWith({
                sessionId: VALID_INPUT.sessionId,
                role: "USER",
                content: VALID_INPUT.prompt,
            });
        });

        it("persists the prompt when the trailing message is an assistant reply", async () => {
            (mockMessageService.getMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
                {
                    id: "msg-assistant-tail",
                    sessionId: VALID_INPUT.sessionId,
                    role: "ASSISTANT",
                    content: VALID_INPUT.prompt,
                    metadata: null,
                    createdAt: new Date(),
                },
            ]);

            await agent.run(VALID_INPUT, () => {});

            expect(mockMessageService.createMessage).toHaveBeenCalledWith({
                sessionId: VALID_INPUT.sessionId,
                role: "USER",
                content: VALID_INPUT.prompt,
            });
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

        it("should continue without memories when memory service fails", async () => {
            (
                mockMemoryService.retrieveRelevant as ReturnType<typeof vi.fn>
            ).mockRejectedValue(new Error("DB connection failed"));

            const events: AgentEventPayload[] = [];
            await agent.run(VALID_INPUT, (e) => events.push(e));

            expect(events.find((e) => e.type === "AGENT_ERROR")).toBeUndefined();
            expect(events.some((e) => e.type === "AGENT_COMPLETED")).toBe(true);
            expect(mockModelFn).toHaveBeenCalled();
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

    describe("premature-stop continuation", () => {
        const TASK_PROMPT =
            "Add a Dockerfile to this repository with a production Node.js build, commit it on a new branch called feat/dockerfile, push the branch, and open a pull request against main.";

        it("nudges a prose stop with a concrete tool directive until the budget is spent", async () => {
            mockModelFn = createMockModelFn({
                content:
                    "The task requires a careful plan. Here is the explanation of what should be done step by step.",
            });

            const nudgingAgent = new Agent({
                contextBuilder,
                memoryService: mockMemoryService,
                messageService: mockMessageService,
                modelFn: mockModelFn,
            });

            const events: AgentEventPayload[] = [];
            await nudgingAgent.run(
                {
                    userId: "user-123",
                    sessionId: "session-nudge",
                    repositoryId: "",
                    prompt: TASK_PROMPT,
                },
                (e) => events.push(e),
            );

            const nudges = events.filter(
                (e) =>
                    e.type === "AGENT_STATUS" &&
                    String(e.content).includes("continuing the run"),
            );
            expect(nudges).toHaveLength(6);
            expect(mockModelFn).toHaveBeenCalledTimes(7);
            expect(
                events.filter((e) => e.type === "AGENT_MESSAGE"),
            ).toHaveLength(1);
            expect(events.some((e) => e.type === "AGENT_COMPLETED")).toBe(true);

            const calls = vi.mocked(mockModelFn).mock.calls;
            for (let i = 1; i < calls.length; i++) {
                const conversation = calls[i]![0] as Array<{
                    role: string;
                    content: string;
                }>;
                const last = conversation[conversation.length - 1]!;
                expect(last.role).toBe("user");
                expect(last.content).toContain("list_files");
                expect(last.content).toContain("reply with prose");
            }
        });

        it("accepts the first answer when nothing is missing", async () => {
            mockModelFn = createMockModelFn({ content: "Here is why: ..." });

            const idleAgent = new Agent({
                contextBuilder,
                memoryService: mockMemoryService,
                messageService: mockMessageService,
                modelFn: mockModelFn,
            });

            const events: AgentEventPayload[] = [];
            await idleAgent.run(
                { ...VALID_INPUT, repositoryId: "" },
                (e) => events.push(e),
            );

            expect(mockModelFn).toHaveBeenCalledTimes(1);
            expect(events.some((e) => e.type === "AGENT_COMPLETED")).toBe(true);
        });
    });

    describe("issue-request completion (no invented follow-up work)", () => {
        function issueToolCall(): {
            content: string | null;
            finishReason: string;
            toolCalls: Array<{
                id: string;
                type: "function";
                function: { name: string; arguments: string };
            }>;
        } {
            return {
                content: null,
                finishReason: "tool_calls",
                toolCalls: [
                    {
                        id: "call-create-issue",
                        type: "function",
                        function: {
                            name: "create_issue",
                            arguments: JSON.stringify({
                                owner: "Arav-Menon",
                                repo: "klinpi",
                                title: "Redesign UI",
                                body: "Request to redesign the user interface for improved usability and modern aesthetics.",
                            }),
                        },
                    },
                ],
            };
        }

        async function runIssueRequest(
            prompt: string,
            finalAnswer: string,
        ): Promise<{ events: AgentEventPayload[]; modelFn: ModelFn }> {
            const modelFn = vi
                .fn()
                .mockResolvedValueOnce(issueToolCall())
                .mockResolvedValue({
                    content: finalAnswer,
                    finishReason: "stop",
                    toolCalls: null,
                }) as unknown as ModelFn;

            const issueAgent = new Agent({
                contextBuilder,
                memoryService: mockMemoryService,
                messageService: mockMessageService,
                modelFn,
            });

            const originalFetch = globalThis.fetch;
            globalThis.fetch = vi.fn().mockResolvedValue(
                new Response(
                    JSON.stringify({
                        number: 10,
                        html_url:
                            "https://github.com/Arav-Menon/klinpi/issues/10",
                        title: "Redesign UI",
                        state: "open",
                    }),
                    { status: 201, headers: { "content-type": "application/json" } },
                ),
            ) as unknown as typeof fetch;

            const events: AgentEventPayload[] = [];
            try {
                await issueAgent.run(
                    {
                        userId: "user-123",
                        sessionId: `session-issue-${crypto.randomUUID()}`,
                        repositoryId: "",
                        prompt,
                    },
                    (e) => events.push(e),
                );
            } finally {
                globalThis.fetch = originalFetch;
            }

            return { events, modelFn };
        }

        function expectSingleIssueRun(
            events: AgentEventPayload[],
            modelFn: ModelFn,
            finalAnswer: string,
            prompt: string,
        ): void {
            const toolNames = events
                .filter((e) => e.type === "TOOL_CALL")
                .map((e) => e.toolCall!.name);
            expect(toolNames).toEqual(["create_issue"]);

            expect(
                events.filter(
                    (e) =>
                        e.type === "AGENT_STATUS" &&
                        String(e.content).includes("continuing the run"),
                ),
            ).toHaveLength(0);

            const messages = events.filter((e) => e.type === "AGENT_MESSAGE");
            expect(messages).toHaveLength(1);
            expect(messages[0]!.content).toBe(finalAnswer);
            expect(events.some((e) => e.type === "AGENT_COMPLETED")).toBe(true);

            expect(vi.mocked(modelFn)).toHaveBeenCalledTimes(2);
            const followUp = vi.mocked(modelFn).mock.calls[1]![0] as Array<{
                role: string;
                content: string | null;
            }>;
            const last = followUp[followUp.length - 1]!;
            expect(last.role).toBe("tool");
            const userMessages = followUp.filter((m) => m.role === "user");
            expect(userMessages).toHaveLength(1);
            expect(userMessages[0]!.content).toBe(prompt);
        }

        it("stops after create_issue succeeds for the reported failure prompt", async () => {
            const prompt =
                "create new issue on this repo bro about redisign the UI";
            const finalAnswer =
                "Created issue #10: Redesign UI — https://github.com/Arav-Menon/klinpi/issues/10";

            const { events, modelFn } = await runIssueRequest(
                prompt,
                finalAnswer,
            );

            expectSingleIssueRun(events, modelFn, finalAnswer, prompt);
        });

        it("stops after create_issue succeeds even when the classifier alone would gap", async () => {
            const prompt = "create a bug report about the broken build";
            const finalAnswer = "Created bug report issue #10: Redesign UI.";

            const { events, modelFn } = await runIssueRequest(
                prompt,
                finalAnswer,
            );

            expectSingleIssueRun(events, modelFn, finalAnswer, prompt);
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

    describe("repository context", () => {
        const CTX_USER_ID = `user-ctx-${crypto.randomUUID()}`;
        const CTX_SESSION_ID = `session-ctx-${crypto.randomUUID()}`;
        const CTX_REPO_ID = `repo-ctx-${crypto.randomUUID()}`;

        const getSystemMessage = (): string => {
            const calls = vi.mocked(mockModelFn).mock.calls;
            expect(calls.length).toBeGreaterThan(0);
            const messages = calls[0]![0] as unknown as Array<{ role: string; content: string }>;
            const system = messages.find((m) => m.role === "system");
            expect(system).toBeDefined();
            return system!.content;
        };

        afterEach(async () => {
            const db = getDb();
            await db.delete(schema.users).where(eq(schema.users.id, CTX_USER_ID));
        });

        async function insertCtxRepository() {
            const db = getDb();
            await db
                .insert(schema.users)
                .values({
                    id: CTX_USER_ID,
                    email: `${CTX_USER_ID}@klinpi.dev`,
                    name: "Repository Context User",
                })
                .onConflictDoNothing();
            await db
                .delete(schema.repositories)
                .where(eq(schema.repositories.id, CTX_REPO_ID));
            await db.insert(schema.repositories).values({
                id: CTX_REPO_ID,
                userId: CTX_USER_ID,
                provider: "GITHUB",
                providerRepoId: `pr-${CTX_REPO_ID}`,
                owner: "test-org",
                name: "ctx-repo",
                fullName: "test-org/ctx-repo",
                cloneUrl: "https://github.com/test-org/ctx-repo.git",
                defaultBranch: "develop",
            });
        }

        it("should include linked repository context in the system message", async () => {
            await insertCtxRepository();

            const events: AgentEventPayload[] = [];
            await agent.run(
                {
                    ...VALID_INPUT,
                    userId: CTX_USER_ID,
                    sessionId: CTX_SESSION_ID,
                    repositoryId: CTX_REPO_ID,
                },
                (e) => events.push(e),
            );

            expect(events.some((e) => e.type === "AGENT_COMPLETED")).toBe(true);
            const system = getSystemMessage();
            expect(system).toContain("Repository context:");
            expect(system).toContain("test-org/ctx-repo");
            expect(system).toContain("/workspace");
            expect(system).toContain("develop");
            expect(system).toContain(
                "Never claim you have no access to repository or project context",
            );
        });

        it("should omit repository context when the repositoryId does not resolve", async () => {
            const events: AgentEventPayload[] = [];
            await agent.run(
                { ...VALID_INPUT, repositoryId: `repo-missing-${crypto.randomUUID()}` },
                (e) => events.push(e),
            );

            expect(events.some((e) => e.type === "AGENT_COMPLETED")).toBe(true);
            const system = getSystemMessage();
            expect(system).not.toContain("Repository context:");
        });

        it("should omit repository context when no repositoryId is supplied", async () => {
            const events: AgentEventPayload[] = [];
            await agent.run({ ...VALID_INPUT, repositoryId: "" }, (e) => events.push(e));

            expect(events.some((e) => e.type === "AGENT_COMPLETED")).toBe(true);
            expect(getSystemMessage()).not.toContain("Repository context:");
        });
    });

    describe("eager repository preparation on an existing sandbox", () => {
        afterEach(() => {
            computeMocks.connect.mockReset();
            computeMocks.create.mockReset();
            computeMocks.register.mockReset();
        });

        it("clones the linked repository before the model runs even without a tool call", async () => {
            const db = getDb();
            const userId = `user-eager-${crypto.randomUUID()}`;
            const sessionId = `session-eager-${crypto.randomUUID()}`;
            const repoId = `repo-eager-${crypto.randomUUID()}`;
            await db.insert(schema.users).values({
                id: userId,
                email: `${userId}@klinpi.dev`,
                name: "Eager Prepare User",
            });
            await db
                .insert(schema.agentSessions)
                .values({ id: sessionId, userId, title: "eager prepare" });
            await db.insert(schema.repositories).values({
                id: repoId,
                userId,
                provider: "GITHUB",
                providerRepoId: `pr-${repoId}`,
                owner: "test-org",
                name: "eager-repo",
                fullName: "test-org/eager-repo",
                cloneUrl: "https://github.com/test-org/eager-repo.git",
                defaultBranch: "main",
            });
            await db.insert(schema.sandboxes).values({
                sessionId,
                providerSandboxId: "sbx-eager-1",
                status: "RUNNING",
                workspacePath: "/workspace",
                branchName: null,
                lastActiveAt: new Date(),
            });

            const run = vi
                .fn()
                .mockResolvedValueOnce({ exitCode: 0, stdout: "NO_REPO\n", stderr: "" })
                .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" });
            const fakeSandbox = {
                sandboxId: "sbx-eager-1",
                setTimeout: vi.fn().mockResolvedValue(undefined),
                commands: { run },
            };
            computeMocks.connect.mockResolvedValue(fakeSandbox);

            try {
                const events: AgentEventPayload[] = [];
                await agent.run(
                    { userId, sessionId, repositoryId: repoId, prompt: "hi" },
                    (e) => events.push(e),
                );

                expect(events.some((e) => e.type === "AGENT_COMPLETED")).toBe(true);
                expect(run).toHaveBeenCalledTimes(2);
                expect(run.mock.calls[0]![0]).toContain("test -d /workspace/.git");
                expect(run.mock.calls[1]![0]).toContain(
                    "git clone --branch main https://github.com/test-org/eager-repo.git /workspace",
                );
                expect(
                    events.some(
                        (e) =>
                            e.type === "AGENT_STATUS" &&
                            e.content === "Repository cloned successfully",
                    ),
                ).toBe(true);

                const calls = vi.mocked(mockModelFn).mock.calls;
                const messages = calls[0]![0] as unknown as Array<{
                    role: string;
                    content: string;
                }>;
                const system = messages.find((m) => m.role === "system");
                expect(system?.content).toContain("Repository context:");
                expect(system?.content).toContain("already cloned there");
            } finally {
                await db
                    .delete(schema.sandboxes)
                    .where(eq(schema.sandboxes.sessionId, sessionId));
                await db
                    .delete(schema.agentSessions)
                    .where(eq(schema.agentSessions.id, sessionId));
                await db
                    .delete(schema.repositories)
                    .where(eq(schema.repositories.id, repoId));
                await db.delete(schema.users).where(eq(schema.users.id, userId));
            }
        });

        it("continues the run when repository preparation fails", async () => {
            const db = getDb();
            const userId = `user-eager-fail-${crypto.randomUUID()}`;
            const sessionId = `session-eager-fail-${crypto.randomUUID()}`;
            const repoId = `repo-eager-fail-${crypto.randomUUID()}`;
            await db.insert(schema.users).values({
                id: userId,
                email: `${userId}@klinpi.dev`,
                name: "Eager Fail User",
            });
            await db
                .insert(schema.agentSessions)
                .values({ id: sessionId, userId, title: "eager fail" });
            await db.insert(schema.repositories).values({
                id: repoId,
                userId,
                provider: "GITHUB",
                providerRepoId: `pr-${repoId}`,
                owner: "test-org",
                name: "fail-repo",
                fullName: "test-org/fail-repo",
                cloneUrl: "https://github.com/test-org/fail-repo.git",
                defaultBranch: "main",
            });
            await db.insert(schema.sandboxes).values({
                sessionId,
                providerSandboxId: "sbx-eager-fail",
                status: "RUNNING",
                workspacePath: "/workspace",
                branchName: null,
                lastActiveAt: new Date(),
            });

            const run = vi
                .fn()
                .mockResolvedValueOnce({ exitCode: 0, stdout: "NO_REPO\n", stderr: "" })
                .mockRejectedValueOnce(
                    Object.assign(new Error("exit status 128"), {
                        stderr: "fatal: repository not found",
                    }),
                );
            const fakeSandbox = {
                sandboxId: "sbx-eager-fail",
                setTimeout: vi.fn().mockResolvedValue(undefined),
                commands: { run },
            };
            computeMocks.connect.mockResolvedValue(fakeSandbox);

            try {
                const events: AgentEventPayload[] = [];
                await agent.run(
                    { userId, sessionId, repositoryId: repoId, prompt: "hi" },
                    (e) => events.push(e),
                );

                expect(events.some((e) => e.type === "AGENT_COMPLETED")).toBe(true);
                const failStatus = events.find(
                    (e) =>
                        e.type === "AGENT_STATUS" &&
                        e.content.startsWith("Repository preparation failed:"),
                );
                expect(failStatus).toBeDefined();
                expect(failStatus!.content).toContain("Clone failed: fatal: repository not found");

                const calls = vi.mocked(mockModelFn).mock.calls;
                const messages = calls[0]![0] as unknown as Array<{
                    role: string;
                    content: string;
                }>;
                const system = messages.find((m) => m.role === "system");
                expect(system?.content).toContain("repository preparation failed");
            } finally {
                await db
                    .delete(schema.sandboxes)
                    .where(eq(schema.sandboxes.sessionId, sessionId));
                await db
                    .delete(schema.agentSessions)
                    .where(eq(schema.agentSessions.id, sessionId));
                await db
                    .delete(schema.repositories)
                    .where(eq(schema.repositories.id, repoId));
                await db.delete(schema.users).where(eq(schema.users.id, userId));
            }
        });
    });
});
