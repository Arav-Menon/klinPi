import { OpenRouter } from "@openrouter/sdk";
import { OPENROUTER_API_KEY } from "@klinpi/common";
import type { LoopMessage, ModelResponse, ModelFn } from "./types.js";

const apiKey = OPENROUTER_API_KEY;
const openrouter = new OpenRouter({ apiKey });

const callModel = async (prompt: string, systemPrompt: string): Promise<string | null> => {
    const response = await openrouter.chat.send({
        chatRequest: {
            model: "inclusionai/ling-3.0-flash-vl:free",
            messages: [
                { role: "user", content: prompt },
                { role: "system", content: systemPrompt }
            ],
            stream: false,
        },
    });

    if (response instanceof ReadableStream) return null;

    const content = response.choices[0]?.message.content;
    if (typeof content === "string") return content;
    return null;
};

const callModelWithTools: ModelFn = async (messages, tools): Promise<ModelResponse> => {
    const response = await openrouter.chat.send({
        chatRequest: {
            model: "inclusionai/ling-3.0-flash-vl:free",
            messages: messages as any,
            tools: tools.length > 0 ? tools : undefined,
            stream: false,
        },
    });

    if (response instanceof ReadableStream) {
        return { content: null, toolCalls: null, finishReason: "error" };
    }

    const choice = response.choices[0];
    if (!choice) {
        return { content: null, toolCalls: null, finishReason: "error" };
    }

    const rawContent = choice.message.content;
    const content = typeof rawContent === "string"
        ? rawContent
        : null;
    const finishReason = choice.finishReason ?? null;

    const rawToolCalls = choice.message.toolCalls;
    const toolCalls = rawToolCalls && rawToolCalls.length > 0
        ? rawToolCalls.map((tc) => ({
              id: tc.id,
              name: tc.function.name,
              arguments: tc.function.arguments,
          }))
        : null;

    return { content, toolCalls, finishReason };
};

export { callModel, callModelWithTools };
