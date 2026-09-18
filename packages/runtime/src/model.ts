import { OpenRouter } from "@openrouter/sdk";

const openrouter = new OpenRouter();

export const callModel = async (prompt: string, systemPrompt: string): Promise<string | null> => {
    const response = await openrouter.chat.send({

        chatRequest: {
            model: "openai/gpt-oss-120b:free",
            messages: [
                { role: "user", content: prompt },
                { role: "system", content: systemPrompt }
            ],
            stream: false,
        },

    })
    if (response instanceof ReadableStream) return null;

    const content = response.choices[0]?.message.content;
    if (typeof content === "string") return content;
    return null;
}