"use client";

import { useMemo, useState } from "react";
import { Popover } from "radix-ui";
import { ChevronRight, FolderGit2, LoaderCircle, Lock, Plus, RefreshCw, Search } from "lucide-react";

import { githubAuthUrl, type GithubRepo } from "@/lib/api";
import { useWorkspace } from "@/app/components/console/workspace-context";
import { cn } from "cn";

/**
 * Composer repository selection — moved out of the sidebar.
 *
 * - `RepositoryPickerButton`: the composer's "+" button. Opens a compact
 *   two-step popover (Repositories → searchable list) on the existing
 *   radix-ui Popover primitive (outside click + Escape handled natively).
 *   Disabled while the session's repository is locked.
 * - `RepositoryChip`: the selected repository pill inside the input row
 *   (lock icon once the session owns a repository).
 * - `RepositoryList`: shared list body with every load state ported from
 *   the old sidebar section (loading / disconnected / error / empty).
 * - `filterRepos`: client-side name/owner filter for the search field and
 *   the "@" mention suggestions.
 */

export function filterRepos(repos: GithubRepo[], query: string): GithubRepo[] {
  const q = query.trim().toLowerCase();
  if (!q) return repos;
  return repos.filter(
    (repo) =>
      repo.full_name.toLowerCase().includes(q) ||
      repo.name.toLowerCase().includes(q) ||
      repo.owner.login.toLowerCase().includes(q),
  );
}

/** Resolves the shared repository source from the workspace context. */
export function useRepositorySource() {
  const { repos, reposStatus, reposError, reloadRepos } = useWorkspace();
  return { repos, status: reposStatus, error: reposError, reload: reloadRepos };
}

interface RepositoryListProps {
  repos: GithubRepo[];
  status: ReturnType<typeof useRepositorySource>["status"];
  error: string | null;
  onReload: () => void;
  onSelect: (repo: GithubRepo) => void | Promise<void>;
  /** Highlighted row index for keyboard navigation (mention list). */
  activeIndex?: number;
  emptyHint?: string;
}

export function RepositoryList({
  repos,
  status,
  error,
  onReload,
  onSelect,
  activeIndex = -1,
  emptyHint = "No repositories found.",
}: RepositoryListProps) {
  if (status === "loading") {
    return (
      <ul className="space-y-0.5 animate-pulse-soft p-1" aria-hidden="true">
        {Array.from({ length: 3 }, (_, i) => (
          <li key={i} className="rounded-lg px-2.5 py-2">
            <div className="h-3 w-2/3 rounded bg-white/10" />
          </li>
        ))}
      </ul>
    );
  }

  if (status === "disconnected") {
    return (
      <div className="p-3 text-center">
        <p className="text-[13px] text-subtle">No GitHub account connected.</p>
        <a
          href={githubAuthUrl()}
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-[13px] text-foreground transition-colors duration-[150ms] hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
        >
          <Plus className="size-3.5" aria-hidden="true" />
          Connect GitHub
        </a>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="p-3">
        <p className="text-[13px] text-subtle">{error}</p>
        <button
          type="button"
          onClick={onReload}
          className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-[13px] text-foreground transition-colors duration-[150ms] hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
        >
          <RefreshCw className="size-3.5" aria-hidden="true" /> Retry
        </button>
      </div>
    );
  }

  if (repos.length === 0) {
    return <p className="px-3 py-3 text-[13px] text-faint">{emptyHint}</p>;
  }

  return (
    <ul className="max-h-64 overflow-y-auto p-1" aria-label="Repositories">
      {repos.map((repo, index) => (
        <li key={repo.repositoryId ?? repo.id}>
          <button
            type="button"
            onClick={() => void onSelect(repo)}
            title={repo.html_url}
            aria-current={index === activeIndex ? "true" : undefined}
            className={cn(
              "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors duration-[150ms] outline-none",
              "focus-visible:ring-2 focus-visible:ring-ring/60",
              index === activeIndex
                ? "bg-accent text-foreground"
                : "text-subtle hover:bg-accent/60 hover:text-foreground",
            )}
          >
            <FolderGit2 className="size-3.5 shrink-0 text-faint" aria-hidden="true" />
            <span className="min-w-0">
              <span className="block truncate text-[13px] leading-4 font-medium text-foreground">
                {repo.owner.login}
              </span>
              <span className="block truncate text-[11px] leading-4 text-faint">{repo.name}</span>
            </span>
            {repo.private ? (
              <span className="ml-auto shrink-0 text-[11px] text-faint">Private</span>
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* "+" button + two-step popover                                       */
/* ------------------------------------------------------------------ */

interface RepositoryPickerButtonProps {
  locked: boolean;
  lockLabel?: string;
  onSelect: (repo: GithubRepo) => void | Promise<void>;
  disabled?: boolean;
}

export function RepositoryPickerButton({
  locked,
  lockLabel,
  onSelect,
  disabled,
}: RepositoryPickerButtonProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"menu" | "repos">("menu");
  const [query, setQuery] = useState("");
  const { repos, status, error, reload } = useRepositorySource();

  const filtered = useMemo(() => filterRepos(repos, query), [repos, query]);
  const inert = locked || disabled;

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setView("menu");
      setQuery("");
    }
  }

  async function handleSelect(repo: GithubRepo) {
    await onSelect(repo);
    handleOpenChange(false);
  }

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={
            locked
              ? `Repository locked${lockLabel ? `: ${lockLabel}` : ""}`
              : "Add repository"
          }
          title={
            locked
              ? `Repository locked${lockLabel ? ` — ${lockLabel}` : ""}`
              : "Add repository"
          }
          disabled={inert}
          className={cn(
            "mt-1.5 flex size-7 shrink-0 items-center justify-center rounded-lg border border-border text-faint transition-colors duration-[150ms] outline-none",
            "hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60",
            inert && "cursor-not-allowed opacity-60 hover:bg-transparent",
          )}
        >
          {locked ? (
            <Lock className="size-3.5" aria-hidden="true" />
          ) : (
            <Plus className="size-4" aria-hidden="true" />
          )}
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          className="w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-lg outline-none"
        >
          {view === "menu" ? (
            <div role="menu" aria-label="Add context" className="p-1">
              <button
                type="button"
                role="menuitem"
                onClick={() => setView("repos")}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-foreground transition-colors duration-[150ms] hover:bg-accent outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
              >
                <FolderGit2 className="size-3.5 text-faint" aria-hidden="true" />
                Repositories
                <ChevronRight className="ml-auto size-3.5 text-faint" aria-hidden="true" />
              </button>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-2 border-b border-border px-2.5 py-2">
                <button
                  type="button"
                  aria-label="Back"
                  onClick={() => setView("menu")}
                  className="rounded p-0.5 text-faint transition-colors duration-[150ms] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 outline-none"
                >
                  <ChevronRight className="size-3.5 rotate-180" aria-hidden="true" />
                </button>
                <Search className="size-3.5 shrink-0 text-faint" aria-hidden="true" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search repositories…"
                  aria-label="Search repositories"
                  className="w-full bg-transparent text-[13px] text-foreground outline-none placeholder:text-faint"
                />
                {status === "loading" ? (
                  <LoaderCircle
                    className="size-3.5 shrink-0 animate-spin text-faint"
                    aria-hidden="true"
                  />
                ) : null}
              </div>
              <RepositoryList
                repos={filtered}
                status={status}
                error={error}
                onReload={reload}
                onSelect={handleSelect}
                emptyHint={query ? "No repositories match." : "No repositories found."}
              />
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/* ------------------------------------------------------------------ */
/* Selected repository chip                                            */
/* ------------------------------------------------------------------ */

interface RepositoryChipProps {
  repo: GithubRepo;
  locked: boolean;
  onClear?: () => void;
}

export function RepositoryChip({ repo, locked, onClear }: RepositoryChipProps) {
  return (
    <span
      className="mt-1.5 flex max-w-[14rem] shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-xs text-subtle"
      title={locked ? `${repo.full_name} — locked to this session` : repo.html_url}
      data-testid="composer-repo-chip"
    >
      <FolderGit2 className="size-3.5 shrink-0 text-faint" aria-hidden="true" />
      <span className="truncate">{repo.full_name}</span>
      {locked ? (
        <Lock className="size-3 shrink-0 text-faint" aria-hidden="true" />
      ) : onClear ? (
        <button
          type="button"
          aria-label="Remove repository"
          onClick={onClear}
          className="ml-0.5 flex size-4 shrink-0 items-center justify-center rounded-full text-faint transition-colors duration-[150ms] hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 outline-none"
        >
          <span aria-hidden="true" className="text-[11px] leading-none">
            ×
          </span>
        </button>
      ) : null}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* "@" suggestion panel wrapper (Composer owns open/query/highlight)   */
/* ------------------------------------------------------------------ */

export function RepositoryMentionPanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute bottom-full left-0 z-30 mb-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-border bg-popover shadow-lg">
      <p className="border-b border-border px-3 py-2 text-[11px] font-medium tracking-wide text-faint uppercase">
        Repositories
      </p>
      {children}
    </div>
  );
}
