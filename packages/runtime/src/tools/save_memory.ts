import type { AgentTool, ToolContext } from "../types.js";
import type { MemoryType, MemoryImportance } from "../state/types.js";

const MEMORY_TYPES: readonly string[] = [
    "USER_PREFERENCE",
    "REPOSITORY_KNOWLEDGE",
    "SESSION_NOTE",
    "FACT",
    "INSTRUCTION",
];
const IMPORTANCES: readonly string[] = ["LOW", "MEDIUM", "HIGH"];
const SCOPES: readonly string[] = ["global", "repository"];

export function createSaveMemoryTool(context: ToolContext): AgentTool {
    return {
        name: "save_memory",
        description:
            "Save an important piece of information to long-term memory so it can be recalled in future conversations. Use it for durable facts: user preferences, standing instructions, key project/repository knowledge, and notable conclusions. Do NOT save transient details (current task steps, temporary file contents, or outputs already visible in the conversation). Saving is idempotent — identical content is deduplicated.",

        parameters: {
            type: "object",
            properties: {
                content: {
                    type: "string",
                    description:
                        "The information to remember, written as a complete self-contained statement (e.g. 'User prefers concise bullet-point answers')",
                },
                type: {
                    type: "string",
                    enum: MEMORY_TYPES,
                    description:
                        "Category: USER_PREFERENCE (likes/dislikes), REPOSITORY_KNOWLEDGE (project facts), SESSION_NOTE (notable outcomes), FACT (general durable facts), INSTRUCTION (standing do/don't rules). Defaults to FACT.",
                },
                importance: {
                    type: "string",
                    enum: IMPORTANCES,
                    description:
                        "How important the memory is: LOW, MEDIUM (default), or HIGH",
                },
                scope: {
                    type: "string",
                    enum: SCOPES,
                    description:
                        "global = recalled in all sessions and repositories; repository = only recalled for this repository. Defaults to repository when a repository is attached, otherwise global. Prefer global for user preferences/instructions and repository for project knowledge.",
                },
            },
            required: ["content"],
        },

        async execute(args) {
            const {
                content,
                type = "FACT",
                importance = "MEDIUM",
                scope,
            } = args as {
                content?: string;
                type?: string;
                importance?: string;
                scope?: string;
            };

            if (typeof content !== "string" || !content.trim()) {
                return "Error: 'content' is required and must be a non-empty string.";
            }
            if (!MEMORY_TYPES.includes(type)) {
                return `Error: invalid type '${type}'. Expected one of: ${MEMORY_TYPES.join(", ")}`;
            }
            if (!IMPORTANCES.includes(importance)) {
                return `Error: invalid importance '${importance}'. Expected one of: ${IMPORTANCES.join(", ")}`;
            }

            const effectiveScope = scope ?? (context.repositoryId ? "repository" : "global");
            if (!SCOPES.includes(effectiveScope)) {
                return `Error: invalid scope '${scope}'. Expected one of: ${SCOPES.join(", ")}`;
            }

            const repositoryId = effectiveScope === "repository" ? context.repositoryId : null;

            try {
                const memory = await context.memoryService.createMemory({
                    userId: context.userId,
                    sessionId: context.sessionId,
                    repositoryId,
                    type: type as MemoryType,
                    content: content.trim(),
                    importance: importance as MemoryImportance,
                });
                return `Memory saved: ${memory.id} (${memory.type}, ${memory.importance}, scope=${repositoryId ? "repository" : "global"})`;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return `Error saving memory: ${message}`;
            }
        },
    };
}
