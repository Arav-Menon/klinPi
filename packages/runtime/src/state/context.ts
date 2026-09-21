import type { MemorySearchResult } from "./types.js";

export interface ContextBuilderInput {
  systemInstructions: string;
  currentPrompt: string;
  recentMessages?: Array<{ role: string; content: string }>;
  memories?: MemorySearchResult[];
  repositoryContext?: string;
}

export interface BuiltContext {
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
}

export class ContextBuilder {
  build(input: ContextBuilderInput): BuiltContext {
    const messages: BuiltContext["messages"] = [];

    const systemParts: string[] = [input.systemInstructions];

    if (input.repositoryContext) {
      systemParts.push(
        `Repository context:\n${input.repositoryContext}`,
      );
    }

    if (input.memories && input.memories.length > 0) {
      const memoryBlock = input.memories
        .map((m, i) => {
          const similarity = Math.round(m.similarity * 100);
          return `${i + 1}. [${m.memory.type}, ${m.memory.importance}, relevance=${similarity}%] ${m.memory.content}`;
        })
        .join("\n");

      systemParts.push(
        `Relevant memories:\n${memoryBlock}`,
      );
    }

    messages.push({
      role: "system",
      content: systemParts.join("\n\n"),
    });

    if (input.recentMessages && input.recentMessages.length > 0) {
      for (const msg of input.recentMessages) {
        messages.push({
          role: msg.role as "user" | "assistant",
          content: msg.content,
        });
      }
    }

    messages.push({
      role: "user",
      content: input.currentPrompt,
    });

    return { messages };
  }
}
