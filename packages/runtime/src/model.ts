import axios from "axios";
import { randomUUID } from "node:crypto";
import { modelConfig } from "./lib/modelConfig.js";
import type { LoopMessage, ModelResponse, ModelFn, ModelToolCall } from "./types.js";

interface WireMessage {
    role: "system" | "user" | "assistant" | "tool";
    content: string | null;
    tool_calls?: ModelToolCall[];
    tool_call_id?: string;
}

interface RawToolCall {
    id?: string;
    type?: string;
    function?: {
        name?: string;
        arguments?: string;
    };
}

interface ChatCompletionResponse {
    choices?: Array<{
        finish_reason?: string | null;
        message?: {
            content?: string | null;
            tool_calls?: RawToolCall[];
        };
    }>;
}

const sendChat = async (body: Record<string, unknown>): Promise<ChatCompletionResponse> => {
    const response = await axios.post<ChatCompletionResponse>(
        `${modelConfig.baseUrl}/v1/chat/completions`,
        {
            ...body,
            model: modelConfig.model,
            stream: false,
        },
        {
            timeout: modelConfig.timeoutMs,
            headers: { "Content-Type": "application/json" },
        },
    );

    return response.data;
};

const toWireMessages = (messages: LoopMessage[]): WireMessage[] => {
    return messages.map((message) => {
        if (message.role === "tool") {
            return {
                role: "tool",
                content: message.content,
                tool_call_id: message.toolCallId,
            };
        }

        if (message.role === "assistant") {
            return {
                role: "assistant",
                content: message.content,
                ...(message.toolCalls && message.toolCalls.length > 0
                    ? { tool_calls: message.toolCalls }
                    : {}),
            };
        }

        return { role: message.role, content: message.content };
    });
};

const toModelToolCalls = (rawToolCalls: RawToolCall[] | undefined): ModelToolCall[] | null => {
    if (!rawToolCalls || rawToolCalls.length === 0) return null;

    const toolCalls = rawToolCalls
        .map((tc) => {
            const name = tc.function?.name;
            if (!name) return null;

            const rawArgs = tc.function?.arguments;
            return {
                id: tc.id && tc.id.length > 0 ? tc.id : randomUUID(),
                type: "function" as const,
                function: {
                    name,
                    arguments:
                        typeof rawArgs === "string"
                            ? rawArgs
                            : JSON.stringify(rawArgs ?? {}),
                },
            };
        })
        .filter((tc): tc is ModelToolCall => tc !== null);

    return toolCalls.length > 0 ? toolCalls : null;
};

const toContent = (rawContent: string | null | undefined): string | null => {
    if (typeof rawContent !== "string") return null;
    return rawContent.trim().length > 0 ? rawContent : null;
};

const toModelResponse = (data: ChatCompletionResponse): ModelResponse => {
    const choice = data.choices?.[0];
    if (!choice) {
        return { content: null, toolCalls: null, finishReason: "error" };
    }

    return {
        content: toContent(choice.message?.content),
        toolCalls: toModelToolCalls(choice.message?.tool_calls),
        finishReason: choice.finish_reason ?? null,
    };
};

const callModel = async (prompt: string, systemPrompt: string): Promise<string | null> => {
    const data = await sendChat({
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt },
        ],
    });

    return toContent(data.choices?.[0]?.message?.content);
};

const callModelWithTools: ModelFn = async (messages, tools): Promise<ModelResponse> => {
    const data = await sendChat({
        messages: toWireMessages(messages),
        ...(tools.length > 0 ? { tools } : {}),
    });

    return toModelResponse(data);
};

export { callModel, callModelWithTools };
