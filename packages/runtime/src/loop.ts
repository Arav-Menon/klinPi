import type {
    AgentTool,
    AgentEventCallback,
    LoopMessage,
    ModelFn,
    ModelToolCall,
} from "./types.js";

const MAX_ITERATIONS = 10;

export interface LoopInput {
    messages: LoopMessage[];
    tools: AgentTool[];
    onEvent: AgentEventCallback;
    modelFn: ModelFn;
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

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
        const response = await modelFn(conversation, openRouterTools);

        const hasToolCalls =
            response.toolCalls !== null &&
            response.toolCalls !== undefined &&
            response.toolCalls.length > 0;

        if (!hasToolCalls) {
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
                    name: toolCall.name,
                    arguments: toolCall.arguments,
                },
            });

            const tool = tools.find((t) => t.name === toolCall.name);

            if (!tool) {
                const errorMessage = `Unknown tool: ${toolCall.name}`;
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

            let args: Record<string, any>;
            try {
                args = JSON.parse(toolCall.arguments);
            } catch {
                const errorMessage = `Invalid JSON arguments for tool ${toolCall.name}: ${toolCall.arguments}`;
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
                result = await tool.execute(args, "");
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
