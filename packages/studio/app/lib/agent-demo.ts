/**
 * Agent event model + demo data.
 *
 * `AgentEvent` mirrors the real union produced by the runtime and streamed
 * over the WebSocket (`AGENT_EVENT` frames): see packages/runtime/src/types.ts
 * and packages/contracts/agent.proto.
 *
 * The landing page renders this shape today with demo data. Swapping in live
 * data later only requires replacing the source of `AgentEvent[]` — the
 * components stay untouched.
 */

export type AgentEventType =
  | "AGENT_STATUS"
  | "AGENT_MESSAGE"
  | "TOOL_CALL"
  | "TOOL_RESULT"
  | "AGENT_ERROR"
  | "AGENT_COMPLETED";

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, string>;
}

export interface ToolResult {
  toolCallId: string;
  output: string;
  isError?: boolean;
}

export interface AgentEvent {
  id: string;
  type: AgentEventType;
  content?: string;
  toolCall?: ToolCall;
  toolResult?: ToolResult;
  /** Wall-clock style stamp used by the log views. */
  timestamp: string;
  /** Demo-only pacing before this event is revealed. */
  delayMs?: number;
}

export const EVENT_LABELS: Record<AgentEventType, string> = {
  AGENT_STATUS: "status",
  AGENT_MESSAGE: "message",
  TOOL_CALL: "tool call",
  TOOL_RESULT: "tool result",
  AGENT_ERROR: "error",
  AGENT_COMPLETED: "completed",
};

/* ------------------------------------------------------------------ *
 * Workspace demo — a full run on a connected repository
 * ------------------------------------------------------------------ */

export const DEMO_REPOSITORY = {
  owner: "arav-menon",
  name: "klinpi",
  fullName: "arav-menon/klinpi",
  branch: "main",
  language: "TypeScript",
} as const;

export const DEMO_TASK =
  "Fix #234 — expired session tokens are not refreshed";

export const DEMO_SESSIONS = [
  { id: "s1", title: "Fix #234 — token refresh", active: true },
  { id: "s2", title: "Rate limit /sessions/search" },
  { id: "s3", title: "Cache invalidation on archive" },
  { id: "s4", title: "Docs: local setup guide" },
];

export const DEMO_FILE_TREE = [
  { depth: 0, name: "packages/", kind: "dir" as const },
  { depth: 1, name: "gateway/src/", kind: "dir" as const },
  { depth: 2, name: "lib/jwt.ts", kind: "file" as const },
  { depth: 2, name: "middleware/auth.middleware.ts", kind: "file" as const, changed: true },
  { depth: 2, name: "modules/routes/", kind: "dir" as const },
  { depth: 0, name: "platform/", kind: "dir" as const },
  { depth: 1, name: "drizzle/schema.ts", kind: "file" as const },
];

export const DEMO_EVENTS: AgentEvent[] = [
  {
    id: "e1",
    type: "AGENT_STATUS",
    content: "Starting agent run",
    timestamp: "09:41:02",
    delayMs: 350,
  },
  {
    id: "e2",
    type: "TOOL_CALL",
    toolCall: {
      id: "c1",
      name: "clone_repo",
      arguments: {
        url: "https://github.com/arav-menon/klinpi.git",
        branch: "main",
      },
    },
    timestamp: "09:41:03",
    delayMs: 700,
  },
  {
    id: "e3",
    type: "TOOL_RESULT",
    toolResult: {
      toolCallId: "c1",
      output: "Cloned 1 file tree into /workspace",
    },
    timestamp: "09:41:07",
    delayMs: 900,
  },
  {
    id: "e4",
    type: "TOOL_CALL",
    toolCall: {
      id: "c2",
      name: "list_files",
      arguments: { path: "/workspace/packages/gateway/src" },
    },
    timestamp: "09:41:08",
    delayMs: 650,
  },
  {
    id: "e5",
    type: "TOOL_RESULT",
    toolResult: {
      toolCallId: "c2",
      output: "lib/ · middleware/ · modules/ · app.ts",
    },
    timestamp: "09:41:08",
    delayMs: 650,
  },
  {
    id: "e6",
    type: "TOOL_CALL",
    toolCall: {
      id: "c3",
      name: "read_file",
      arguments: { path: "/workspace/packages/gateway/src/lib/jwt.ts" },
    },
    timestamp: "09:41:09",
    delayMs: 750,
  },
  {
    id: "e7",
    type: "TOOL_RESULT",
    toolResult: { toolCallId: "c3", output: "Read 128 lines" },
    timestamp: "09:41:10",
    delayMs: 900,
  },
  {
    id: "e8",
    type: "AGENT_MESSAGE",
    content:
      "Refresh only happens when the cookie is already expired. Requests inside the 15-minute window keep using a stale token — that is the failure in #234.",
    timestamp: "09:41:12",
    delayMs: 1200,
  },
  {
    id: "e9",
    type: "TOOL_CALL",
    toolCall: {
      id: "c4",
      name: "edit_file",
      arguments: {
        path: "/workspace/packages/gateway/src/middleware/auth.middleware.ts",
        bytes: "1.4 KB",
      },
    },
    timestamp: "09:41:15",
    delayMs: 1100,
  },
  {
    id: "e10",
    type: "TOOL_RESULT",
    toolResult: { toolCallId: "c4", output: "Wrote 64 lines" },
    timestamp: "09:41:16",
    delayMs: 800,
  },
  {
    id: "e11",
    type: "AGENT_MESSAGE",
    content:
      "Refresh now runs when the token is within the expiry window, and the fresh cookie is set before the request continues. Re-read of the file confirms the change.",
    timestamp: "09:41:19",
    delayMs: 1200,
  },
  {
    id: "e12",
    type: "AGENT_COMPLETED",
    content: "Run completed — 1 file changed",
    timestamp: "09:41:21",
    delayMs: 900,
  },
];

/* Terminal output shown alongside the activity stream. */
export const DEMO_TERMINAL: { line: string; delayMs?: number; tone?: "cmd" | "out" | "ok" | "add" | "dim" }[] = [
  { line: "git clone --branch main github.com/arav-menon/klinpi.git /workspace", tone: "cmd", delayMs: 700 },
  { line: "Cloning into '/workspace'... done.", tone: "out", delayMs: 500 },
  { line: "cat packages/gateway/src/lib/jwt.ts", tone: "cmd", delayMs: 650 },
  { line: "128 lines read into context", tone: "dim", delayMs: 500 },
  { line: "edit packages/gateway/src/middleware/auth.middleware.ts", tone: "cmd", delayMs: 750 },
  { line: "refreshSession(req, res)  // inside expiry window", tone: "add", delayMs: 450 },
  { line: "return continueWithFreshCookie(req, res)", tone: "add", delayMs: 350 },
  { line: "run pnpm test -- auth", tone: "cmd", delayMs: 750 },
  { line: "PASS  tests/gateway/auth.test.ts  (14 tests)", tone: "ok", delayMs: 600 },
];

/* ------------------------------------------------------------------ *
 * Compact stream used by the "live activity" section
 * ------------------------------------------------------------------ */

export const DEMO_FEED: AgentEvent[] = [
  { id: "f1", type: "AGENT_STATUS", content: "Subscribed to session", timestamp: "10:02:41", delayMs: 400 },
  {
    id: "f2",
    type: "TOOL_CALL",
    toolCall: { id: "t1", name: "list_files", arguments: { path: "/workspace" } },
    timestamp: "10:02:42",
    delayMs: 700,
  },
  {
    id: "f3",
    type: "TOOL_RESULT",
    toolResult: { toolCallId: "t1", output: "17 entries" },
    timestamp: "10:02:42",
    delayMs: 600,
  },
  {
    id: "f4",
    type: "TOOL_CALL",
    toolCall: {
      id: "t2",
      name: "read_file",
      arguments: { path: "/workspace/packages/runtime/src/loop.ts" },
    },
    timestamp: "10:02:43",
    delayMs: 750,
  },
  {
    id: "f5",
    type: "TOOL_RESULT",
    toolResult: { toolCallId: "t2", output: "Read 155 lines" },
    timestamp: "10:02:44",
    delayMs: 650,
  },
  {
    id: "f6",
    type: "AGENT_MESSAGE",
    content: "Iteration 2 of 10 — next tool: edit_file",
    timestamp: "10:02:45",
    delayMs: 800,
  },
  {
    id: "f7",
    type: "TOOL_CALL",
    toolCall: { id: "t3", name: "save_memory", arguments: { type: "REPOSITORY_KNOWLEDGE" } },
    timestamp: "10:02:46",
    delayMs: 700,
  },
  { id: "f8", type: "AGENT_COMPLETED", content: "Changes ready for review", timestamp: "10:02:49", delayMs: 900 },
];
