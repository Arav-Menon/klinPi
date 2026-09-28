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
