"use client";

import { useState, type FormEvent } from "react";
import { ArrowUp, LoaderCircle } from "lucide-react";

import { Button } from "@/app/components/ui/button";
import { cn } from "cn";

interface ComposerProps {
  /**
   * Submit handler. Returning `false` (or throwing) keeps the draft so a
   * failed send is never lost; anything else clears the input.
   */
  onSubmit?: (message: string) => boolean | void | Promise<boolean | void>;
  placeholder?: string;
  disabled?: boolean;
  /** Explicit status line (connection / agent state). */
  statusText?: string;
  statusTone?: "muted" | "danger";
}

/**
 * Prompt composer for the agent. Full keyboard handling (Enter sends,
 * Shift+Enter inserts a newline), focus-visible states, duplicate-submit
 * protection while in flight, and a status row for connection state.
 */
export function Composer({
  onSubmit,
  placeholder = "Give Klinpi a task…",
  disabled,
  statusText,
  statusTone = "muted",
}: ComposerProps) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const connected = Boolean(onSubmit);
  const canSend = connected && text.trim().length > 0 && !sending && !disabled;

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSend || !onSubmit) return;
    const message = text.trim();
    setSending(true);
    try {
      const result = await onSubmit(message);
      if (result === false) return; // not sent — keep the draft
      setText("");
    } catch {
      // Failed — keep the draft for a retry.
    } finally {
      setSending(false);
    }
  }

  const hint =
    statusText ??
    (connected
      ? "Enter to send · Shift + Enter for a new line"
      : "Agent runtime not connected — messages can’t be sent yet.");

  return (
    <div className="shrink-0 border-t border-border bg-background px-4 pt-3 pb-4">
      <form onSubmit={handleSubmit} className="mx-auto w-full max-w-3xl">
        <div
          className={cn(
            "rounded-2xl border border-border bg-surface-raised px-3 pt-2.5 pb-2 transition-colors duration-[150ms]",
            "focus-within:border-accent-blue/50",
          )}
        >
          <label htmlFor="console-composer" className="sr-only">
            Message Klinpi
          </label>
          <textarea
            id="console-composer"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends when connected; Shift+Enter always inserts a newline.
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && canSend) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            rows={2}
            placeholder={placeholder}
            className="max-h-40 min-h-[44px] w-full resize-none bg-transparent text-sm leading-6 text-foreground outline-none placeholder:text-faint"
          />
          <div className="flex items-center justify-between gap-3 pt-1">
            <p
              className={cn(
                "truncate text-[11px] leading-4",
                statusTone === "danger" ? "text-danger" : "text-faint",
              )}
              data-runtime-status
            >
              {hint}
            </p>
            <Button
              type="submit"
              size="icon-sm"
              disabled={!canSend}
              aria-label="Send message"
              className="shrink-0 rounded-full"
            >
              {sending ? (
                <LoaderCircle className="animate-spin" aria-hidden="true" />
              ) : (
                <ArrowUp aria-hidden="true" />
              )}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
