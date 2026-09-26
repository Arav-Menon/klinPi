export interface AgentTool {
    name: string;
    description: string;
    requiresSandbox?: boolean;

    parameters: {
        type: "object";
        properties: Record<string, unknown>;
        required?: string[];
    };

    execute(
        args: Record<string, any>,
        context: string,
    ): Promise<any>;
}

import type { MemoryService } from "./state/memory.js";

export interface ToolContext {
    memoryService: MemoryService;
    userId: string;
    sessionId: string;
    repositoryId: string | null;
}

export interface AgentRunInput {
    userId: string;
    sessionId: string;
    repositoryId: string;
    prompt: string;
}

export type AgentEventType =
    | "AGENT_STATUS"
    | "AGENT_MESSAGE"
    | "TOOL_CALL"
    | "TOOL_RESULT"
    | "AGENT_ERROR"
    | "AGENT_COMPLETED";

export interface AgentEventPayload {
    sessionId?: string;
    type: AgentEventType;
    content?: string;
    timestamp?: number;
    sequence?: number;
    toolCall?: {
        id: string;
        name: string;
        arguments: string;
    };
    toolResult?: {
        toolCallId: string;
        output: string;
        isError: boolean;
    };
}

export type AgentEventCallback = (event: AgentEventPayload) => void;

export interface ModelToolCall {
    id: string;
    type: "function";
    function: {
        name: string;
        arguments: string;
    };
}

export type LoopMessage =
    | { role: "system"; content: string }
    | { role: "user"; content: string }
    | { role: "assistant"; content: string | null; toolCalls?: ModelToolCall[] }
    | { role: "tool"; toolCallId: string; content: string };

export interface ModelResponse {
    content: string | null;
    toolCalls: ModelToolCall[] | null;
    finishReason: string | null;
}

export type ModelFn = (
    messages: LoopMessage[],
    tools: Array<{
        type: "function";
        function: {
            name: string;
            description: string;
            parameters: Record<string, unknown>;
        };
    }>,
) => Promise<ModelResponse>;