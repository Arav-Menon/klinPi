import axios, { AxiosError } from "axios";
import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import { modelConfig } from "./lib/modelConfig.js";
import type {
    LoopMessage,
    ModelResponse,
    ModelFn,
    ModelToolCall,
} from "./types.js";

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

/** One `tool_calls` fragment from an SSE delta, keyed by `index`. */
interface StreamToolCallFragment {
    index?: number;
    id?: string;
    type?: string;
    function?: {
        name?: string;
        arguments?: string;
    };
}

interface ChatCompletionChunk {
    choices?: Array<{
        finish_reason?: string | null;
        delta?: {
            content?: string | null;
            tool_calls?: StreamToolCallFragment[];
        };
    }>;
}

interface SendChatOptions {
    /**
     * Override the configured provider timeout (diagnostics/tests).
     * The default remains `modelConfig.timeoutMs`.
     */
    timeoutMs?: number;
    /**
     * Override the provider base URL (diagnostics/tests).
     * The default remains `modelConfig.baseUrl`.
     */
    baseUrl?: string;
}

const PROVIDER_PATH = "/v1/chat/completions";
const STREAM_DONE_SENTINEL = "[DONE]";

/**
 * Map provider/connection failures onto clear, phase-tagged messages so a
 * failed run reports WHAT timed out instead of a bare axios error. Unknown
 * errors are returned untouched.
 */
const normalizeProviderError = (
    error: unknown,
    url: string,
    timeoutMs: number,
    phase: string,
): unknown => {
    const details = `model=${modelConfig.model}, url=${url}`;
    if (error instanceof AxiosError) {
        const message = error.message ?? "";
        if (
            error.code === "ETIMEDOUT" ||
            error.code === "ECONNABORTED" ||
            /timeout of \d+ms exceeded/i.test(message)
        ) {
            return new Error(
                `Model provider request timed out after ${timeoutMs}ms (phase=${phase}, ${details})`,
            );
        }
        if (
            error.code === "ECONNREFUSED" ||
            error.code === "ENOTFOUND" ||
            error.code === "EAI_AGAIN" ||
            error.code === "ECONNRESET" ||
            error.code === "EPIPE"
        ) {
            return new Error(
                `Model provider unreachable: ${error.code} (phase=${phase}, ${details})`,
            );
        }
        if (/\baborted\b|socket hang up|terminated/i.test(message)) {
            return new Error(
                `Model provider connection closed unexpectedly (phase=${phase}, ${details})`,
            );
        }
    }
    if (error instanceof Error && /timeout of \d+ms exceeded/i.test(error.message)) {
        return new Error(
            `Model provider request timed out after ${timeoutMs}ms (phase=${phase}, ${details})`,
        );
    }
    return error;
};

/**
 * Consume an SSE response body and assemble it into the same shape the
 * non-streaming endpoint returned, so `toModelResponse` is unchanged.
 *
 * Streaming keeps axios' socket timeout an IDLE timeout: every chunk resets
 * it, so a healthy-but-slow generation (long model thinking) is never killed
 * while a provider that stops sending data still aborts after `timeoutMs`.
 */
const collectStreamResponse = (
    stream: Readable,
    url: string,
    timeoutMs: number,
): Promise<ChatCompletionResponse> =>
    new Promise((resolve, reject) => {
        let settled = false;
        let buffer = "";
        let content = "";
        let finishReason: string | null = null;
        let receivedChunk = false;
        const toolCalls = new Map<number, { id: string; name: string; args: string }>();

        const buildResponse = (): ChatCompletionResponse => {
            // Unique per-call suffix: a fixed `call-${index}` fallback would
            // collide across responses from providers that omit ids, putting
            // duplicate tool_call_ids into the conversation and letting
            // results attach to the wrong call.
            const fallbackPrefix = `call-${randomUUID().slice(0, 8)}`;
            const ordered = [...toolCalls.entries()]
                .sort(([a], [b]) => a - b)
                .map(([index, toolCall]) => ({
                    id:
                        toolCall.id && toolCall.id.length > 0
                            ? toolCall.id
                            : `${fallbackPrefix}-${index}`,
                    type: "function",
                    function: {
                        name: toolCall.name,
                        arguments: toolCall.args,
                    },
                }));
            return {
                choices: [
                    {
                        finish_reason: finishReason,
                        message: {
                            content: content.length > 0 ? content : null,
                            ...(ordered.length > 0 ? { tool_calls: ordered } : {}),
                        },
                    },
                ],
            };
        };

        const cleanup = () => {
            stream.destroy();
        };

        const succeed = () => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(buildResponse());
        };

        const fail = (error: unknown) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(normalizeProviderError(error, url, timeoutMs, "model_request"));
        };

        const noDataError = () =>
            new Error(
                `Model provider stream ended without data (phase=model_request, model=${modelConfig.model}, url=${url})`,
            );

        const processToolCallFragment = (fragment: StreamToolCallFragment) => {
            const index =
                typeof fragment.index === "number" ? fragment.index : toolCalls.size;
            const entry = toolCalls.get(index) ?? { id: "", name: "", args: "" };
            if (fragment.id && entry.id.length === 0) {
                entry.id = fragment.id;
            }
            const fragmentName = fragment.function?.name;
            if (fragmentName && fragmentName.length > 0 && entry.name.length === 0) {
                entry.name = fragmentName;
            }
            const fragmentArgs = fragment.function?.arguments;
            if (typeof fragmentArgs === "string" && fragmentArgs.length > 0) {
                if (entry.args.length === 0) {
                    entry.args = fragmentArgs;
                } else if (fragmentArgs.startsWith(entry.args)) {
                    // Provider resent the arguments cumulatively.
                    entry.args = fragmentArgs;
                } else {
                    entry.args += fragmentArgs;
                }
            }
            toolCalls.set(index, entry);
        };

        const processLine = (rawLine: string) => {
            const line = rawLine.replace(/\r$/, "");
            if (!line.startsWith("data:")) return;
            const data = line.slice(5).trim();
            if (data.length === 0) return;
            if (data === STREAM_DONE_SENTINEL) {
                succeed();
                return;
            }
            let chunk: ChatCompletionChunk;
            try {
                chunk = JSON.parse(data) as ChatCompletionChunk;
            } catch {
                // Tolerate malformed keep-alive/comment lines mid-stream.
                return;
            }
            receivedChunk = true;
            const choice = chunk.choices?.[0];
            if (!choice) return;
            if (typeof choice.finish_reason === "string") {
                finishReason = choice.finish_reason;
            }
            const delta = choice.delta;
            if (typeof delta?.content === "string" && delta.content.length > 0) {
                content += delta.content;
            }
            for (const fragment of delta?.tool_calls ?? []) {
                processToolCallFragment(fragment);
            }
        };

        stream.setEncoding("utf8");
        stream.on("data", (chunk: string) => {
            buffer += chunk;
            let newlineIndex = buffer.indexOf("\n");
            while (newlineIndex !== -1) {
                const line = buffer.slice(0, newlineIndex);
                buffer = buffer.slice(newlineIndex + 1);
                processLine(line);
                if (settled) return;
                newlineIndex = buffer.indexOf("\n");
            }
        });
        stream.on("end", () => {
            if (settled) return;
            if (buffer.trim().length > 0) {
                processLine(buffer);
                if (settled) return;
            }
            if (receivedChunk) {
                // Some providers close without a final [DONE]; accept what we have.
                succeed();
            } else {
                fail(noDataError());
            }
        });
        stream.on("error", (error) => fail(error));
        stream.on("close", () => {
            if (settled) return;
            if (receivedChunk) {
                succeed();
            } else {
                fail(noDataError());
            }
        });
    });

const sendChat = async (
    body: Record<string, unknown>,
    options: SendChatOptions = {},
): Promise<ChatCompletionResponse> => {
    const baseUrl = options.baseUrl ?? modelConfig.baseUrl;
    const timeoutMs = options.timeoutMs ?? modelConfig.timeoutMs;
    const url = `${baseUrl}${PROVIDER_PATH}`;
    try {
        const response = await axios.post(
            url,
            {
                ...body,
                model: modelConfig.model,
                stream: true,
            },
            {
                timeout: timeoutMs,
                responseType: "stream",
                headers: { "Content-Type": "application/json" },
            },
        );
        return await collectStreamResponse(
            response.data as Readable,
            url,
            timeoutMs,
        );
    } catch (error) {
        throw normalizeProviderError(error, url, timeoutMs, "model_request");
    }
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

const toModelToolCalls = (
    rawToolCalls: RawToolCall[] | undefined,
): ModelToolCall[] | null => {
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

const callModel = async (
    prompt: string,
    systemPrompt: string,
): Promise<string | null> => {
    const data = await sendChat({
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt },
        ],
    });

    return toContent(data.choices?.[0]?.message?.content);
};

const callModelWithTools: ModelFn = async (
    messages,
    tools,
): Promise<ModelResponse> => {
    const data = await sendChat({
        messages: toWireMessages(messages),
        ...(tools.length > 0 ? { tools } : {}),
    });

    return toModelResponse(data);
};

export { callModel, callModelWithTools, sendChat };
