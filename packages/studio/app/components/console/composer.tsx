"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowUp, LoaderCircle } from "lucide-react";

import {
  RepositoryChip,
  RepositoryList,
  RepositoryMentionPanel,
  RepositoryPickerButton,
  filterRepos,
  useRepositorySource,
} from "@/app/components/console/composer-repository";
import type { GithubRepo } from "@/lib/api";
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
  /** Repository bound to this workspace (pending selection or session link). */
  repo?: GithubRepo | null;
  /** True once the repository is immutable for the session. */
  repoLocked?: boolean;
  /** Bind a repository ("+" menu or "@" mention). */
  onSelectRepo?: (repo: GithubRepo) => void | Promise<void>;
  /** Drop the pending selection (console only — locked sessions can't clear). */
  onClearRepo?: () => void;
}

/** Last `@query` token ending at the caret, or null when not in one. */
function mentionQueryAt(text: string, caret: number): string | null {
  const upto = text.slice(0, caret);
  const match = upto.match(/(?:^|\s)@([\w./-]*)$/);
  return match ? match[1] : null;
}

/**
 * Prompt composer for the agent. Full keyboard handling (Enter sends,
 * Shift+Enter inserts a newline), focus-visible states, duplicate-submit
 * protection while in flight, and a status row for connection state.
 *
 * Repository context lives in the composer itself:
 * - "+" opens the repository picker (locked sessions show a lock).
 * - The selected repository renders as a chip before the input.
 * - Typing "@query" opens repository suggestions (↑/↓, Enter, Esc);
 *   sessions that already own a repository never open the menu.
 */
export function Composer({
  onSubmit,
  placeholder = "Give Klinpi a task…",
  disabled,
  statusText,
  statusTone = "muted",
  repo = null,
  repoLocked = false,
  onSelectRepo,
  onClearRepo,
}: ComposerProps) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [mention, setMention] = useState<{ query: string; caret: number } | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [pickError, setPickError] = useState<string | null>(null);

  const { repos, status, error, reload } = useRepositorySource();
  const suggestions = mention ? filterRepos(repos, mention.query) : [];

  const connected = Boolean(onSubmit);
  const canSend = connected && text.trim().length > 0 && !sending && !disabled;

  function syncMention(nextText: string, caret: number) {
    const query = repoLocked ? null : mentionQueryAt(nextText, caret);
    if (query !== null) {
      setMention({ query, caret });
      setHighlight(0);
    } else if (mention) {
      setMention(null);
    }
  }

  function handleChange(next: string) {
    setText(next);
    setPickError(null);
    syncMention(next, next.length);
  }

  async function applyRepo(repo: GithubRepo) {
    setPickError(null);
    try {
      await onSelectRepo?.(repo);
    } catch (err: unknown) {
      setPickError(err instanceof Error ? err.message : "Couldn't select the repository.");
    }
  }

  function selectMention(repo: GithubRepo) {
    if (!mention) return;
    const { caret } = mention;
    const before = text.slice(0, caret);
    const token = before.match(/(?:^|\s)@[\w./-]*$/);
    const start = token ? before.length - token[0].length : caret;
    const after = text.slice(caret);
    const next = text.slice(0, start) + (after ? " " : "") + after;
    setMention(null);
    setText(next);
    void applyRepo(repo);
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSend || !onSubmit) return;
    const message = text.trim();
    setSending(true);
    setMention(null);
    setPickError(null);
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

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (mention && suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((h) => Math.max(h - 1, 0));
        return;
      }
      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        const repo = suggestions[highlight];
        if (repo) selectMention(repo);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMention(null);
        return;
      }
    } else if (mention && e.key === "Escape") {
      setMention(null);
      return;
    }

    // Enter sends when connected; Shift+Enter always inserts a newline.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && canSend) {
      e.preventDefault();
      e.currentTarget.form?.requestSubmit();
    }
  }

  const hint =
    pickError ??
    statusText ??
    (connected
      ? "Enter to send · Shift + Enter for a new line"
      : "Agent runtime not connected — messages can’t be sent yet.");

  return (
    <div className="shrink-0 border-t border-border bg-background px-4 pt-3 pb-4">
      <form onSubmit={handleSubmit} className="mx-auto w-full max-w-3xl">
        <div
          className={cn(
            "relative rounded-2xl border border-border bg-surface-raised px-3 pt-2.5 pb-2 transition-colors duration-[150ms]",
            "focus-within:border-accent-blue/50",
          )}
        >
          <label htmlFor="console-composer" className="sr-only">
            Message Klinpi
          </label>

          <div className="flex items-start gap-2">
            <RepositoryPickerButton
              locked={repoLocked}
              lockLabel={repo?.full_name}
              onSelect={(r) => applyRepo(r)}
              disabled={!onSelectRepo}
            />
            {repo ? (
              <RepositoryChip
                repo={repo}
                locked={repoLocked}
                onClear={repoLocked ? undefined : onClearRepo}
              />
            ) : null}
            <textarea
              id="console-composer"
              value={text}
              onChange={(e) => handleChange(e.target.value)}
              onClick={(e) =>
                syncMention(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)
              }
              onKeyDown={handleKeyDown}
              onBlur={() => setMention(null)}
              rows={2}
              placeholder={placeholder}
              className="max-h-40 min-h-[44px] w-full min-w-0 flex-1 resize-none bg-transparent text-sm leading-6 text-foreground outline-none placeholder:text-faint"
            />
          </div>

          {mention ? (
            <RepositoryMentionPanel>
              <div onMouseDown={(e) => e.preventDefault()}>
                <RepositoryList
                  repos={suggestions}
                  status={status}
                  error={error}
                  onReload={reload}
                  onSelect={selectMention}
                  activeIndex={highlight}
                  emptyHint={mention.query ? "No repositories match." : "No repositories found."}
                />
              </div>
            </RepositoryMentionPanel>
          ) : null}

          <div className="flex items-center justify-between gap-3 pt-1">
            <p
              className={cn(
                "truncate text-[11px] leading-4",
                statusTone === "danger" || pickError ? "text-danger" : "text-faint",
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
