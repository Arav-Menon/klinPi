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
import { createSandbox } from "@klinpi/compute";
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

            await this.messageService.createMessage({
                sessionId,
                role: "USER",
                content: prompt,
            });

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

            const context = this.contextBuilder.build({
                systemInstructions: this.systemInstructions,
                currentPrompt: prompt,
                recentMessages: recentMessages.map((m) => ({
                    role: m.role.toLowerCase(),
                    content: m.content,
                })),
                memories,
            });

            const tools = getTools();

            let repositoryCloneUrl: string | undefined;
            let repositoryDefaultBranch: string | undefined;
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
                }
            }

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

            if (repositoryCloneUrl) {
                const cloneUrl = repositoryCloneUrl;
                const branch = repositoryDefaultBranch ?? "main";
                loopInput.createSandbox = async () => {
                    const { sandbox } = await createSandbox();
                    emit({ type: "AGENT_STATUS", content: `Cloning ${cloneUrl} (branch: ${branch})...` });
                    const result = await sandbox.commands.run(
                        `git clone --branch ${branch} ${cloneUrl} /workspace`,
                    );
                    if (result.exitCode !== 0) {
                        throw new Error(`Clone failed: ${result.stderr}`);
                    }
                    emit({ type: "AGENT_STATUS", content: "Repository cloned successfully" });
                    return sandbox.sandboxId;
                };
                loopInput.destroySandbox = async () => {
                    try {
                        const { sandboxManger } = await import("@klinpi/compute");
                        await sandboxManger.destroySbx();
                    } catch {
                        // Sandbox cleanup is best-effort
                    }
                };
            }

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
