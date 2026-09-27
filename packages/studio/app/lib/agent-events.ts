import type { SessionMessage } from "@/lib/api";
import type { AgentEvent } from "@/app/lib/ws";

/**
 * Clean presentation model for the conversation region. Raw
 * `AGENT_EVENT` frames and DB rows are mapped into these items — the UI
 * never renders raw event JSON.
 */

export type ConversationItem =
  | {
      kind: "message";
      id: string;
      role: "USER" | "ASSISTANT" | "SYSTEM" | "TOOL";
      content: string;
      createdAt?: string;
    }
  | { kind: "status"; id: string; content: string }
  | {
      kind: "tool";
      id: string;
      callId: string;
      name: string;
      arguments: string | Record<string, unknown> | null;
      result?: { output: string; isError?: boolean };
      done: boolean;
    }
  | { kind: "error"; id: string; content: string };

let itemCounter = 0;
function nextId(prefix: string): string {
  itemCounter += 1;
  return `${prefix}-${itemCounter}`;
}

/** Optimistic item for a prompt the user just sent over the socket. */
export function newUserMessageItem(content: string): ConversationItem {
  return { kind: "message", id: nextId("user"), role: "USER", content };
}

/** Persisted history (`Message` table) → conversation items, oldest first. */
export function messagesToItems(messages: SessionMessage[]): ConversationItem[] {
  return messages.map((m) => ({
    kind: "message",
    id: `history-${m.id}`,
    role: m.role === "USER" || m.role === "ASSISTANT" || m.role === "SYSTEM" ? m.role : "TOOL",
    content: m.content,
    createdAt: m.createdAt,
  }));
}

/**
 * Merge fresh history with live items: history is the source of truth for
 * messages (dropping optimistic copies), while tool/status/error rows only
 * exist live and are preserved.
 */
export function reconcileHistory(
  history: ConversationItem[],
  live: ConversationItem[],
): ConversationItem[] {
  return [...history, ...live.filter((item) => item.kind !== "message")];
}

/** Apply one live `AGENT_EVENT` to the conversation. */
export function applyAgentEvent(
  items: ConversationItem[],
  event: AgentEvent,
): ConversationItem[] {
  switch (event.eventType) {
    case "AGENT_STATUS": {
      if (!event.content) return items;
      return [...items, { kind: "status", id: nextId("status"), content: event.content }];
    }
    case "AGENT_MESSAGE": {
      if (!event.content) return items;
      return [
        ...items,
        { kind: "message", id: nextId("msg"), role: "ASSISTANT", content: event.content },
      ];
    }
    case "TOOL_CALL": {
      const call = event.toolCall;
      return [
        ...items,
        {
          kind: "tool",
          id: nextId("tool"),
          callId: call?.id ?? nextId("call"),
          name: call?.name ?? "tool",
          arguments: call?.arguments ?? null,
          done: false,
        },
      ];
    }
    case "TOOL_RESULT": {
      const result = event.toolResult;
      const callId = result?.toolCallId;
      let matched = false;
      const next = items.map((item) => {
        if (item.kind === "tool" && !item.done && callId && item.callId === callId) {
          matched = true;
          return {
            ...item,
            done: true,
            result: { output: result?.output ?? "", isError: result?.isError },
          };
        }
        return item;
      });
      if (matched) return next;
      // Result arrived without its call (e.g. after a reconcile) — show it.
      return [
        ...next,
        {
          kind: "tool",
          id: nextId("tool"),
          callId: callId ?? nextId("call"),
          name: "tool",
          arguments: null,
          done: true,
          result: { output: result?.output ?? "", isError: result?.isError },
        },
      ];
    }
    case "AGENT_ERROR": {
      return [
        ...items,
        {
          kind: "error",
          id: nextId("err"),
          content: event.content || "The agent run failed.",
        },
      ];
    }
    case "AGENT_COMPLETED": {
      return [...items, { kind: "status", id: nextId("done"), content: "Run completed." }];
    }
    default:
      return items;
  }
}

/** Pretty-print a tool's arguments (wire value is a JSON string). */
export function formatToolArguments(
  args: string | Record<string, unknown> | null | undefined,
): string {
  if (args === null || args === undefined) return "";
  if (typeof args === "string") {
    try {
      return JSON.stringify(JSON.parse(args), null, 2);
    } catch {
      return args;
    }
  }
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return "";
  }
}

/** One-line tool summary, e.g. the file path for read_file. */
export function toolSummary(
  name: string,
  args: string | Record<string, unknown> | null | undefined,
): string {
  let parsed: Record<string, unknown> | null = null;
  if (args && typeof args === "string") {
    try {
      parsed = JSON.parse(args) as Record<string, unknown>;
    } catch {
      return args.length > 80 ? `${args.slice(0, 80)}…` : args;
    }
  } else if (args && typeof args === "object") {
    parsed = args;
  }
  if (!parsed) return "";
  for (const key of ["path", "file_path", "filePath", "url", "target", "repo"]) {
    const value = parsed[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  const first = Object.values(parsed).find((v) => typeof v === "string");
  return typeof first === "string" ? first : "";
}
