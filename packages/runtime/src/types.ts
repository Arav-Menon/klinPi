import type { ToolCapability } from "./lib/taskScope.js";

export interface AgentTool {
    name: string;
    description: string;
    requiresSandbox?: boolean;
    /**
     * What this tool is capable of doing, used by task-scope filtering and
     * authorization. Tools without capabilities are treated as available
     * under every scope (back-compat for ad-hoc/test tools); every tool in
     * the real registry carries an explicit tag.
     */
    capabilities?: readonly ToolCapability[];
    /**
     * Maximum execution time in milliseconds before the loop abandons the
     * call and reports a timeout to the model. Defaults to
     * `DEFAULT_TOOL_TIMEOUT_MS` in loop.ts.
     */
    timeoutMs?: number;
    /**
     * True for tools that mutate state on GitHub's side (issues, PRs).
     * The loop refuses to execute these while the run is still recovering
     * from a failed tool call: a failure is resolved with a corrected or
     * same-objective action, never with an unrelated external mutation.
     */
    githubMutation?: boolean;

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
import type { RunWorkflowState } from "./lib/workflowState.js";

export interface ToolContext {
    memoryService: MemoryService;
    userId: string;
    sessionId: string;
    repositoryId: string | null;
    /** State shared by the tools of a single agent run (read → write → push → PR). */
    workflow: RunWorkflowState;
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