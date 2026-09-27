"use client";

import { FolderGit2, Plus, RefreshCw } from "lucide-react";

import { githubAuthUrl } from "@/lib/api";
import { useWorkspace } from "@/app/components/console/workspace-context";
import { Button } from "@/app/components/ui/button";
import { cn } from "cn";

const MAX_REPOS = 6;

/**
 * Live GitHub repositories for the user (gateway proxy). Selecting a repo
 * sets workspace context; the console's first prompt links it to the new
 * session via `repositoryId`.
 */
export function SidebarRepositories() {
  const { repos, reposStatus, reposError, reloadRepos, selectedRepo, selectRepo } = useWorkspace();

  if (reposStatus === "loading") {
    return (
      <section aria-label="Repositories" className="mt-5">
        <SectionHeading>Repositories</SectionHeading>
        <ul className="space-y-0.5 animate-pulse-soft" aria-hidden="true">
          {Array.from({ length: 3 }, (_, i) => (
            <li key={i} className="rounded-lg px-2.5 py-2">
              <div className="h-3 w-2/3 rounded bg-white/10" />
            </li>
          ))}
        </ul>
      </section>
    );
  }

  if (reposStatus === "disconnected") {
    return (
      <section aria-label="Repositories" className="mt-5">
        <SectionHeading>Repositories</SectionHeading>
        <div className="rounded-lg border border-dashed border-border px-3 py-3 text-center">
          <p className="text-[13px] text-subtle">No GitHub account connected.</p>
          <a
            href={githubAuthUrl()}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-[13px] text-foreground transition-colors duration-[150ms] hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
          >
            <Plus className="size-3.5" aria-hidden="true" />
            Connect GitHub
          </a>
        </div>
      </section>
    );
  }

  if (reposStatus === "error") {
    return (
      <section aria-label="Repositories" className="mt-5">
        <SectionHeading>Repositories</SectionHeading>
        <div className="px-2.5 py-2">
          <p className="text-[13px] text-subtle">{reposError}</p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={reloadRepos}
            className="mt-1.5 text-faint hover:text-foreground"
          >
            <RefreshCw aria-hidden="true" /> Retry
          </Button>
        </div>
      </section>
    );
  }

  const visible = repos.slice(0, MAX_REPOS);

  return (
    <section aria-label="Repositories" className="mt-5">
      <SectionHeading>Repositories</SectionHeading>
      {visible.length === 0 ? (
        <p className="px-2.5 py-2 text-[13px] text-faint">No repositories found.</p>
      ) : (
        <ul className="space-y-0.5">
          {visible.map((repo) => {
            const selected = selectedRepo?.id === repo.id;
            return (
              <li key={repo.id}>
                <button
                  type="button"
                  onClick={() => selectRepo(selected ? null : repo)}
                  aria-pressed={selected}
                  title={repo.html_url}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors duration-[150ms] outline-none",
                    "focus-visible:ring-2 focus-visible:ring-ring/60",
                    selected
                      ? "bg-accent text-foreground"
                      : "text-subtle hover:bg-accent/60 hover:text-foreground",
                  )}
                >
                  <FolderGit2 className="size-3.5 shrink-0 text-faint" aria-hidden="true" />
                  <span className="truncate text-[13px] leading-4 font-medium">
                    {repo.full_name}
                  </span>
                  {repo.private ? (
                    <span className="ml-auto shrink-0 text-[11px] text-faint">Private</span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {repos.length > MAX_REPOS ? (
        <p className="px-2.5 pt-1.5 text-[11px] text-faint">
          {repos.length - MAX_REPOS} more on GitHub
        </p>
      ) : null}
    </section>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-1 h-6 px-2.5 text-[11px] leading-6 font-medium tracking-wide text-faint uppercase">
      {children}
    </h2>
  );
}
