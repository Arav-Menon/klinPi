import type {
    AgentRunInput,
    AgentEventCallback,
    AgentEventPayload,
    ModelFn,
} from "./types.js";
import { ContextBuilder } from "./state/context.js";
import type { MemoryService } from "./state/memory.js";
import { MessageService } from "./state/message.js";
import { getTools } from "./tools/index.js";
import { runLoop } from "./loop.js";
import { callModelWithTools } from "./model.js";
import { SYSTEM_PROMPT } from "./lib/system-prompt.js";
import { sessionSandboxService } from "./sandbox/sessionSandboxService.js";
import { getDb, schema } from "@klinpi/db";
import { eq } from "drizzle-orm";

export interface AgentConfig {
    contextBuilder: ContextBuilder;
    memoryService: MemoryService;
    messageService: MessageService;
    systemInstructions?: string;
    modelFn?: ModelFn;
}

export class Agent {
    private readonly contextBuilder: ContextBuilder;
    private readonly memoryService: MemoryService;
    private readonly messageService: MessageService;
    private readonly systemInstructions: string;
    private readonly modelFn: ModelFn;

    constructor(config: AgentConfig) {
        this.contextBuilder = config.contextBuilder;
        this.memoryService = config.memoryService;
        this.messageService = config.messageService;
        this.systemInstructions = config.systemInstructions ?? SYSTEM_PROMPT;
        this.modelFn = config.modelFn ?? callModelWithTools;
    }

    async run(
        input: AgentRunInput,
        onEvent: AgentEventCallback,
    ): Promise<void> {
        const { userId, sessionId, repositoryId, prompt } = input;

        let sequence = 0;
        const emit = (event: AgentEventPayload) => {
            onEvent({
                ...event,
                sessionId,
                timestamp: Date.now(),
                sequence: sequence++,
            });
        };

        const missingField = (() => {
            switch (true) {
                case !userId:
                    return "userId";
                case !sessionId:
                    return "sessionId";
                case !prompt:
                    return "prompt";
                default:
                    return null;
            }
        })();

        if (missingField) {
            emit({
                type: "AGENT_ERROR",
                content: `${missingField} is required`,
            });
            return;
        }

        try {
            emit({ type: "AGENT_STATUS", content: "Starting agent run" });

            const recentMessages = await this.messageService.getMessages(
                sessionId,
                { limit: 20 },
            );

            // The gateway persists the USER prompt when a session is created
            // over HTTP; skip re-inserting an identical trailing prompt (the
            // WS auto-create path still inserts here).
            const lastMessage = recentMessages[recentMessages.length - 1];
            const promptAlreadyPersisted =
                lastMessage !== undefined &&
                lastMessage.role === "USER" &&
                lastMessage.content === prompt;

            if (!promptAlreadyPersisted) {
                await this.messageService.createMessage({
                    sessionId,
                    role: "USER",
                    content: prompt,
                });
            }

            let memories: Awaited<ReturnType<typeof this.memoryService.retrieveRelevant>> = [];
            try {
                memories = await this.memoryService.retrieveRelevant({
                    userId,
                    repositoryId: repositoryId || null,
                    query: prompt,
                });
            } catch (err) {
                console.warn("Memory retrieval failed, continuing without memories:", err);
            }

            let repositoryCloneUrl: string | undefined;
            let repositoryDefaultBranch: string | undefined;
            let repositoryFullName: string | undefined;
            if (repositoryId) {
                const db = getDb();
                const [repo] = await db
                    .select()
                    .from(schema.repositories)
                    .where(eq(schema.repositories.id, repositoryId))
                    .limit(1);
                if (repo) {
                    repositoryCloneUrl = repo.cloneUrl;
                    repositoryDefaultBranch = repo.defaultBranch;
                    repositoryFullName = repo.fullName;
                } else {
                    console.warn(
                        `[AgentPipeline] sessionId=${sessionId} repositoryId=${repositoryId} not found in Repository table — running without repository context`,
                    );
                }
            }

            console.log(
                `[AgentPipeline] sessionId=${sessionId} userId=${userId} repositoryId=${repositoryId ?? "none"} repository=${repositoryFullName ?? "none"} branch=${repositoryDefaultBranch ?? "none"} cloneUrl=${repositoryCloneUrl ?? "none"}`,
            );

            // Sandbox lifecycle is runtime-owned for every session: reuse an
            // existing one, and lazily create on the first sandbox-dependent
            // tool (cloning the linked repository when one exists, otherwise
            // preparing an empty workspace). When an existing sandbox is
            // reused, the linked repository is prepared eagerly so the model
            // always reasons over a workspace that matches the session.
            let existingSandboxId: string | undefined;
            try {
                existingSandboxId =
                    (await sessionSandboxService.refresh(sessionId)) ?? undefined;
            } catch (error) {
                console.warn(
                    "Sandbox refresh failed, continuing without an existing sandbox:",
                    error,
                );
            }

            let workspaceReady = false;
            let prepareFailure: string | undefined;
            if (existingSandboxId) {
                emit({
                    type: "AGENT_STATUS",
                    content: `Existing sandbox found — lifetime extended (30 min): ${existingSandboxId}`,
                });
                if (repositoryCloneUrl) {
                    try {
                        await sessionSandboxService.prepareRepository({
                            sessionId,
                            sandboxId: existingSandboxId,
                            userId,
                            ...(repositoryId ? { repositoryId } : {}),
                            cloneUrl: repositoryCloneUrl,
                            branch: repositoryDefaultBranch ?? "main",
                            onStatus: (content) => emit({ type: "AGENT_STATUS", content }),
                        });
                        workspaceReady = true;
                    } catch (error) {
                        prepareFailure = (
                            error instanceof Error ? error.message : String(error)
                        ).slice(0, 300);
                        console.error(
                            `[AgentPipeline] sessionId=${sessionId} repositoryId=${repositoryId ?? "none"} repository prepare failed: ${prepareFailure}`,
                        );
                        emit({
                            type: "AGENT_STATUS",
                            content: `Repository preparation failed: ${prepareFailure}`,
                        });
                    }
                }
            }

            const workspaceLine = !repositoryCloneUrl
                ? undefined
                : workspaceReady
                  ? "- Workspace: /workspace inside this session's sandbox — the repository is already cloned there; inspect it with list_files / read_file"
                  : prepareFailure
                    ? `- Workspace: /workspace inside this session's sandbox — repository preparation failed (${prepareFailure}); the workspace may be empty`
                    : "- Workspace: /workspace inside this session's sandbox — the runtime clones the repository there automatically the first time you call a repository tool";

            const repositoryContext =
                repositoryCloneUrl && repositoryFullName && workspaceLine
                    ? [
                          `- Repository: ${repositoryFullName}`,
                          `- Default branch: ${repositoryDefaultBranch ?? "main"}`,
                          `- Clone source: ${repositoryCloneUrl}`,
                          workspaceLine,
                          "",
                          "A repository IS linked to this session. Questions about \"this project\" or \"this repository\" are repository tasks: inspect the actual files with list_files and read_file (start at /workspace) and answer from what you find. Never claim you have no access to repository or project context when this block is present. You do not need to ask the user which repository to use — it is stated above.",
                      ].join("\n")
                    : undefined;

            const context = this.contextBuilder.build({
                systemInstructions: this.systemInstructions,
                currentPrompt: prompt,
                recentMessages: recentMessages.map((m) => ({
                    role: m.role.toLowerCase(),
                    content: m.content,
                })),
                memories,
                ...(repositoryContext ? { repositoryContext } : {}),
            });

            const tools = getTools({
                memoryService: this.memoryService,
                userId,
                sessionId,
                repositoryId: repositoryId || null,
            });

            const wrappedOnEvent = (event: AgentEventPayload) => {
                if (event.type === "AGENT_MESSAGE" && event.content) {
                    this.messageService
                        .createMessage({
                            sessionId,
                            role: "ASSISTANT",
                            content: event.content,
                        })
                        .catch((err) => {
                            console.error(
                                "Failed to persist assistant message:",
                                err,
                            );
                        });
                }
                emit(event);
            };

            const loopInput: import("./loop.js").LoopInput = {
                messages: context.messages,
                tools,
                onEvent: wrappedOnEvent,
                modelFn: this.modelFn,
            };

            if (existingSandboxId) {
                loopInput.initialSandboxId = existingSandboxId;
                if (repositoryCloneUrl) {
                    loopInput.prepareSandbox = async () =>
                        sessionSandboxService.prepareRepository({
                            sessionId,
                            sandboxId: existingSandboxId,
                            userId,
                            ...(repositoryId ? { repositoryId } : {}),
                            cloneUrl: repositoryCloneUrl!,
                            branch: repositoryDefaultBranch ?? "main",
                            onStatus: (content) => emit({ type: "AGENT_STATUS", content }),
                        });
                }
            }

            const cloneUrl = repositoryCloneUrl;
            loopInput.createSandbox = async () =>
                sessionSandboxService.ensure({
                    sessionId,
                    userId,
                    ...(repositoryId ? { repositoryId } : {}),
                    ...(cloneUrl
                        ? { cloneUrl, branch: repositoryDefaultBranch ?? "main" }
                        : {}),
                    onStatus: (content) => emit({ type: "AGENT_STATUS", content }),
                });

            await runLoop(loopInput);

            emit({ type: "AGENT_COMPLETED" });
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            console.error(
                `Agent run failed [sessionId=${sessionId}, userId=${userId}, repositoryId=${repositoryId}]:`,
                message,
            );
            emit({ type: "AGENT_ERROR", content: message });
        }
    }
}
