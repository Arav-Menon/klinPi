import { Agent } from "../agent.js";
import { ContextBuilder } from "../state/context.js";
import { MemoryService } from "../state/memory.js";
import { MessageService } from "../state/message.js";
import { OllamaEmbeddingProvider } from "../state/embedding.js";

const embeddingProvider = new OllamaEmbeddingProvider();
const memoryService = new MemoryService(embeddingProvider);
const messageService = new MessageService();
const contextBuilder = new ContextBuilder();

export async function handleRunAgent(call: any): Promise<void> {
    const { userId, sessionId, repositoryId, prompt } = call.request;

    const agent = new Agent({
        contextBuilder,
        memoryService,
        messageService,
    });

    await agent.run(
        { userId, sessionId, repositoryId, prompt },
        (event: any) => call.write(event),
    );

    call.end();
}
