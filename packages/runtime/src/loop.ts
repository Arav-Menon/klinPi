import type {
    AgentTool,
    AgentEventCallback,
    LoopMessage,
    ModelFn,
    ModelToolCall,
} from "./types.js";
import { recoverTextToolCalls } from "./lib/toolCallRecovery.js";

export const MAX_ITERATIONS = 30;

export interface LoopInput {
    messages: LoopMessage[];
    tools: AgentTool[];
    onEvent: AgentEventCallback;
    modelFn: ModelFn;
    initialSandboxId?: string;
    createSandbox?: () => Promise<string>;
    prepareSandbox?: () => Promise<void>;
    /**
     * Called when the model returns no tool calls (a candidate final answer).
     * Return a corrective message to append and keep the loop going, or null
     * to accept the message as the run's final answer. The callback owns the
     * retry budget so a blocked run can still terminate.
     */
    nudgeOnStop?: (content: string) => string | null;
}

function convertToolsToOpenRouter(
    tools: AgentTool[],
): Array<{
    type: "function";
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
}> {
    return tools.map((tool) => ({
        type: "function" as const,
        function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters as Record<string, unknown>,
        },
    }));
}

export async function runLoop(input: LoopInput): Promise<void> {
    const { messages, tools, onEvent, modelFn } = input;

    const openRouterTools = convertToolsToOpenRouter(tools);
    const conversation: LoopMessage[] = [...messages];
    const toolNames = new Set(tools.map((tool) => tool.name));
    // For tools with one obvious argument, a bare string written in prose
    // (`run_command("npm test")`) can be mapped onto that parameter.
    const paramHints: Record<string, string> = {};
    for (const tool of tools) {
        const required = tool.parameters.required ?? [];
        const properties = Object.keys(tool.parameters.properties ?? {});
        if (required.length === 1 && properties.includes(required[0]!)) {
            paramHints[tool.name] = required[0]!;
        } else if (required.length === 0 && properties.length === 1) {
            paramHints[tool.name] = properties[0]!;
        }
    }
    let sandboxId: string | undefined = input.initialSandboxId;
    let sandboxPrepared = false;

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
        let response = await modelFn(conversation, openRouterTools);

        // Local models sometimes emit a tool call as message text (JSON or a
        // shell-style `run_command("...")`) instead of a structured
        // `tool_calls` entry. Recover it so the call is actually executed (and
        // its preconditions enforced) rather than being rendered as the final
        // answer.
        if (
            (!response.toolCalls || response.toolCalls.length === 0) &&
            response.content
        ) {
            const recovered = recoverTextToolCalls(
                response.content,
                toolNames,
                paramHints,
            );
            if (recovered) {
                response = {
                    ...response,
                    toolCalls: recovered.toolCalls,
                    content: recovered.remainder,
                };
            }
        }

        const hasToolCalls =
            response.toolCalls !== null &&
            response.toolCalls !== undefined &&
            response.toolCalls.length > 0;

        if (!hasToolCalls) {
            // A model can stop while the requested work is still unfinished
            // (prose instead of the next tool call). Let the caller decide
            // whether to push the run forward one more time.
            const nudge = input.nudgeOnStop?.(response.content ?? "");
            if (nudge) {
                if (response.content) {
                    conversation.push({
                        role: "assistant",
                        content: response.content,
                    });
                }
                conversation.push({ role: "user", content: nudge });
                onEvent({
                    type: "AGENT_STATUS",
                    content: "Requested steps are still incomplete — continuing the run",
                });
                continue;
            }
            if (response.content) {
                onEvent({
                    type: "AGENT_MESSAGE",
                    content: response.content,
                });
            }
            return;
        }

        conversation.push({
            role: "assistant",
            content: response.content,
            toolCalls: response.toolCalls!,
        });

        for (const toolCall of response.toolCalls!) {
            onEvent({
                type: "TOOL_CALL",
                toolCall: {
                    id: toolCall.id,
                    name: toolCall.function.name,
                    arguments: toolCall.function.arguments,
                },
            });

            const tool = tools.find((t) => t.name === toolCall.function.name);

            if (!tool) {
                const errorMessage = `Unknown tool: ${toolCall.function.name}. Available tools: ${tools
                    .map((tool) => tool.name)
                    .join(", ")}`;
                onEvent({
                    type: "TOOL_RESULT",
                    toolResult: {
                        toolCallId: toolCall.id,
                        output: errorMessage,
                        isError: true,
                    },
                });
                conversation.push({
                    role: "tool",
                    toolCallId: toolCall.id,
                    content: errorMessage,
                });
                continue;
            }

            if (tool.requiresSandbox) {
                if (!sandboxId && input.createSandbox) {
                    onEvent({ type: "AGENT_STATUS", content: "Creating sandbox..." });
                    sandboxId = await input.createSandbox();
                    sandboxPrepared = true;
                    onEvent({ type: "AGENT_STATUS", content: `Sandbox ready: ${sandboxId}` });
                } else if (sandboxId && input.prepareSandbox && !sandboxPrepared) {
                    await input.prepareSandbox();
                    sandboxPrepared = true;
                }
            }

            let args: Record<string, any>;
            try {
                args = JSON.parse(toolCall.function.arguments);
            } catch {
                const errorMessage = `Invalid JSON arguments for tool ${toolCall.function.name}: ${toolCall.function.arguments}`;
                onEvent({
                    type: "TOOL_RESULT",
                    toolResult: {
                        toolCallId: toolCall.id,
                        output: errorMessage,
                        isError: true,
                    },
                });
                conversation.push({
                    role: "tool",
                    toolCallId: toolCall.id,
                    content: errorMessage,
                });
                continue;
            }

            let result: any;
            try {
                result = await tool.execute(args, sandboxId ?? "");
            } catch (error) {
                const message =
                    error instanceof Error ? error.message : String(error);
                result = `Tool execution failed: ${message}`;
            }

            const resultString =
                typeof result === "string" ? result : JSON.stringify(result);

            onEvent({
                type: "TOOL_RESULT",
                toolResult: {
                    toolCallId: toolCall.id,
                    output: resultString,
                    isError: false,
                },
            });

            conversation.push({
                role: "tool",
                toolCallId: toolCall.id,
                content: resultString,
            });
        }
    }

    onEvent({
        type: "AGENT_ERROR",
        content: `Max iterations (${MAX_ITERATIONS}) reached`,
    });
}
