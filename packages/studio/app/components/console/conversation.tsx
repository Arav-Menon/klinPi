"use client";

import { useEffect, useRef } from "react";
import { LoaderCircle } from "lucide-react";

import { LogoMark } from "@/app/components/landing/logo";
import type { ConversationItem } from "@/app/lib/agent-events";
import { formatToolArguments, toolSummary } from "@/app/lib/agent-events";
import { cn } from "cn";

const ROLE_LABEL: Record<string, string> = {
  USER: "User",
  ASSISTANT: "Agent",
  SYSTEM: "System",
  TOOL: "Tool",
};

/**
 * Conversation region for `/session/[sessionId]`.
 *
 * Renders the clean presentation model (`ConversationItem`) — user and
 * agent messages, status lines, tool call/result blocks and errors.
 * Raw event frames never reach this component.
 */
export function Conversation({
  items,
  loading,
}: {
  items: ConversationItem[];
  loading: boolean;
}) {
  const scrollRef = useRef<HTMLElement>(null);
  const stickToBottom = useRef(true);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !stickToBottom.current) return;
    el.scrollTop = el.scrollHeight;
  }, [items]);

  if (loading && items.length === 0) {
    return (
      <section
        aria-label="Conversation"
        className="min-h-0 flex-1 overflow-y-auto"
        data-agent-events-region
      >
        <div className="mx-auto w-full max-w-3xl space-y-4 px-6 py-8" aria-hidden="true">
          <div className="h-4 w-1/4 animate-pulse-soft rounded bg-white/10" />
          <div className="ml-auto h-16 w-3/4 animate-pulse-soft rounded-xl bg-white/[0.06]" />
          <div className="h-4 w-1/3 animate-pulse-soft rounded bg-white/10" />
          <div className="h-20 w-full animate-pulse-soft rounded-xl bg-white/[0.06]" />
        </div>
      </section>
    );
  }

  if (items.length === 0) {
    return (
      <section
        aria-label="Conversation"
        className="min-h-0 flex-1 overflow-y-auto"
        data-agent-events-region
      >
        <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col items-center justify-center px-6 py-10 text-center">
          <LogoMark inverse className="mb-5 h-7" />
          <h2 className="text-balance text-lg font-semibold tracking-[-0.02em] text-foreground">
            No messages yet
          </h2>
          <p className="mt-2 max-w-md text-balance text-sm leading-6 text-subtle">
            Agent messages, tool calls and results stream into this workspace.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section
      ref={scrollRef}
      onScroll={handleScroll}
      aria-label="Conversation"
      aria-live="polite"
      tabIndex={0}
      className="min-h-0 flex-1 overflow-y-auto"
      data-agent-events-region
    >
      <ol className="mx-auto w-full max-w-3xl space-y-5 px-6 py-6">
        {items.map((item) => (
          <li key={item.id}>{renderItem(item)}</li>
        ))}
      </ol>
    </section>
  );
}

function renderItem(item: ConversationItem) {
  if (item.kind === "message") {
    const isUser = item.role === "USER";
    return (
      <div
        data-message-role={item.role}
        className={cn("rounded-xl border px-4 py-3", isUser
          ? "border-border bg-surface-raised"
          : "border-transparent bg-transparent")}
      >
        <p className="mb-1.5 text-[11px] font-medium tracking-wide text-faint uppercase">
          {ROLE_LABEL[item.role] ?? item.role}
        </p>
        <p className="text-sm leading-6 whitespace-pre-wrap text-foreground">{item.content}</p>
      </div>
    );
  }

  if (item.kind === "status") {
    return (
      <p className="flex items-center gap-2 text-xs text-faint" data-item-kind="status">
        <span aria-hidden="true" className="size-1 rounded-full bg-faint" />
        {item.content}
      </p>
    );
  }

  if (item.kind === "error") {
    return (
      <div
        className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3"
        data-item-kind="error"
        role="alert"
      >
        <p className="mb-1 text-[11px] font-medium tracking-wide text-danger uppercase">Error</p>
        <p className="text-sm leading-6 text-foreground">{item.content}</p>
      </div>
    );
  }

  // Tool call / result block.
  const summary = toolSummary(item.name, item.arguments);
  const argsText = formatToolArguments(item.arguments);
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface-raised" data-item-kind="tool">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <span className="text-[11px] font-medium tracking-wide text-faint uppercase">
          Tool call
        </span>
        <span className="truncate font-mono text-xs text-foreground">{item.name}</span>
        {summary ? (
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-faint" title={summary}>
            {summary}
          </span>
        ) : null}
        {!item.done ? (
          <LoaderCircle className="ml-auto size-3.5 shrink-0 animate-spin text-faint" aria-hidden="true" />
        ) : null}
      </div>
      {argsText ? (
        <pre className="max-h-40 overflow-auto px-4 py-2.5 font-mono text-xs leading-5 whitespace-pre-wrap text-subtle">
          {argsText}
        </pre>
      ) : null}
      {item.done && item.result ? (
        <div
          className={cn(
            "border-t px-4 py-2.5",
            item.result.isError ? "border-danger/30 bg-danger/10" : "border-border bg-background/40",
          )}
        >
          <p
            className={cn(
              "mb-1 text-[11px] font-medium tracking-wide uppercase",
              item.result.isError ? "text-danger" : "text-faint",
            )}
          >
            Tool result
          </p>
          <pre className="max-h-48 overflow-auto font-mono text-xs leading-5 whitespace-pre-wrap text-subtle">
            {item.result.output || (item.result.isError ? "Failed" : "OK")}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
