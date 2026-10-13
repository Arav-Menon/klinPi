import type { MemorySearchResult } from "./types.js";

export interface ContextBuilderInput {
  systemInstructions: string;
  currentPrompt: string;
  recentMessages?: Array<{ role: string; content: string }>;
  memories?: MemorySearchResult[];
  repositoryContext?: string;
  /**
   * The tools actually registered for this run. Rendered into the system
   * message so the model's view of its capabilities is generated from the
   * same array that is sent to the model and executed by the loop — never
   * from a hand-maintained list.
   */
  availableTools?: Array<{ name: string; description: string }>;
  /** Truthful session note shown when no repository is linked. */
  repositoryNote?: string;
}

export interface BuiltContext {
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
}

/** First sentence of a tool description, for the compact inventory. */
function firstSentence(description: string): string {
  const match = /^[^.!?]*[.!?]/.exec(description);
  const sentence = match ? match[0] : description;
  return sentence.trim() || description.trim();
}

/**
 * Re-anchor emitted after conversation history.
 *
 * History is replayed verbatim, so an earlier assistant message that
 * mis-stated the agent's identity or its tool inventory would otherwise
 * be the model's most recent "fact" — observed in production as the
 * agent calling itself "CodeBot" and claiming it only has GitHub
 * issue/PR tools. This block restates identity and points back at the
 * authoritative inventory, derived from the run's actual tool array
 * (never a hand-maintained list). Only present when there is history to
 * correct against; a fresh session already has the system instructions
 * as its most recent context.
 */
function reAnchorBlock(
  availableTools: Array<{ name: string; description: string }>,
): string {
  const names = availableTools.map((tool) => tool.name).join(", ");
  return [
    "Reminder (authoritative for this run):",
    "You are Klinpi. The “Registered tools” list in your instructions is the",
    "source of truth for which tools exist — answer any question about your",
    "identity or your capabilities from it and from this run's tool list,",
    "never from earlier conversation messages. Tools registered for this run:",
    names,
  ].join(" ");
}

export class ContextBuilder {
  build(input: ContextBuilderInput): BuiltContext {
    const messages: BuiltContext["messages"] = [];

    const systemParts: string[] = [input.systemInstructions];

    if (input.availableTools && input.availableTools.length > 0) {
      const inventory = input.availableTools
        .map((tool) => `- ${tool.name}: ${firstSentence(tool.description)}`)
        .join("\n");
      systemParts.push(
        `Registered tools (authoritative list for this run):\n${inventory}`,
      );
    }

    if (input.repositoryContext) {
      systemParts.push(
        `Repository context:\n${input.repositoryContext}`,
      );
    }

    if (input.repositoryNote) {
      systemParts.push(input.repositoryNote);
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
        // DB roles are uppercase enums (USER/ASSISTANT/SYSTEM) while the
        // model wire API expects lowercase — normalize on the way out.
        const raw = msg.role.toLowerCase();
        const role: "user" | "assistant" | "system" =
          raw === "assistant" || raw === "system" ? raw : "user";
        messages.push({
          role,
          content: msg.content,
        });
      }

      // History may contain stale identity/capability claims — re-anchor
      // right after it, before the current prompt, from this run's tools.
      if (input.availableTools && input.availableTools.length > 0) {
        messages.push({
          role: "system",
          content: reAnchorBlock(input.availableTools),
        });
      }
    }

    // History may already end with the current prompt (the gateway persists
    // it at session creation) — don't append an identical trailing message.
    const lastRecent = input.recentMessages?.[input.recentMessages.length - 1];
    const promptAlreadyInHistory =
      lastRecent !== undefined &&
      lastRecent.role.toLowerCase() === "user" &&
      lastRecent.content === input.currentPrompt;

    if (!promptAlreadyInHistory) {
      messages.push({
        role: "user",
        content: input.currentPrompt,
      });
    }

    return { messages };
  }
}
