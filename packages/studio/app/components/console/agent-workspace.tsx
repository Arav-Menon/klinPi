"use client";

import { LogoMark } from "@/app/components/landing/logo";
import { useWorkspace } from "@/app/components/console/workspace-context";

/**
 * Conversation region.
 *
 * V1 renders the intentional empty state. The layout is shaped for the
 * eventual realtime stream: agent events (AGENT_STATUS, TOOL_CALL,
 * TOOL_RESULT, AGENT_MESSAGE, AGENT_COMPLETED, AGENT_ERROR — the contract
 * in packages/contracts/agent.proto) will render as an ordered list in
 * this scroll container above the empty state. No mock event system is
 * implemented here.
 */
export function AgentWorkspace() {
  const { activeSession } = useWorkspace();

  return (
    <section
      aria-label="Conversation"
      className="min-h-0 flex-1 overflow-y-auto"
      data-agent-events-region
    >
      <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col items-center justify-center px-6 py-10 text-center">
        <LogoMark inverse className="mb-5 h-7" />
        <h2 className="text-balance text-lg font-semibold tracking-[-0.02em] text-foreground">
          {activeSession ? "No messages yet" : "What should Klinpi work on?"}
        </h2>
        <p className="mt-2 max-w-md text-balance text-sm leading-6 text-subtle">
          {activeSession
            ? "Agent messages, tool calls and results will stream into this workspace."
            : "Start a session, pick a repository and give Klinpi a task — the conversation with your agent lives here."}
        </p>
      </div>
    </section>
  );
}
