"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LoaderCircle, Plus, RefreshCw, Search, X } from "lucide-react";

import { searchSessions, sessionPath, type Session } from "@/lib/api";
import { useGoToConsole, useWorkspace } from "@/app/components/console/workspace-context";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { cn } from "cn";

const STATUS_DOT: Record<string, string> = {
  ACTIVE: "bg-success",
  PAUSED: "bg-warning",
  COMPLETED: "bg-faint",
  FAILED: "bg-danger",
  ARCHIVED: "bg-faint",
};

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Active",
  PAUSED: "Paused",
  COMPLETED: "Completed",
  FAILED: "Failed",
  ARCHIVED: "Archived",
};

export function timeAgo(iso: string): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return "";
  const seconds = Math.max(0, (Date.now() - time) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(time).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function SessionRow({
  session,
  active,
}: {
  session: Session;
  active: boolean;
}) {
  return (
    <li>
      <Link
        href={sessionPath(session.id)}
        aria-current={active ? "page" : undefined}
        className={cn(
          "relative block w-full rounded-lg px-2.5 py-2 text-left transition-colors duration-[150ms] outline-none",
          "focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-0",
          active ? "bg-accent text-foreground" : "text-subtle hover:bg-accent/60 hover:text-foreground",
        )}
      >
        {active ? (
          <span
            aria-hidden="true"
            className="absolute top-1/2 left-0 h-4 w-0.5 -translate-y-1/2 rounded-full bg-accent-blue"
          />
        ) : null}
        <span className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT[session.status] ?? "bg-faint")}
          />
          <span className="truncate text-[13px] leading-4 font-medium">
            {session.title || "Untitled session"}
          </span>
        </span>
        <span className="mt-1 flex items-center gap-1.5 pl-3.5 text-[11px] leading-4 text-faint">
          <span>{timeAgo(session.updatedAt)}</span>
          <span aria-hidden="true">·</span>
          <span>{STATUS_LABEL[session.status] ?? session.status}</span>
        </span>
      </Link>
    </li>
  );
}

function SectionHeading({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-1 flex h-6 items-center justify-between px-2.5">
      <h2 className="text-[11px] font-medium tracking-wide text-faint uppercase">{children}</h2>
      {aside}
    </div>
  );
}

function SkeletonRows({ count = 3 }: { count?: number }) {
  return (
    <ul className="space-y-1" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="rounded-lg px-2.5 py-2">
          <div className="h-3 w-3/5 animate-pulse-soft rounded bg-white/10" />
          <div className="mt-2 h-2.5 w-2/5 animate-pulse-soft rounded bg-white/[0.06]" />
        </li>
      ))}
    </ul>
  );
}

/**
 * Recent sessions + title search. Search calls the gateway's real
 * `GET /api/v1/sessions/search`; idle state shows the recent list.
 * Rows link to `/session/<id>`; the active session is derived from the
 * route so browser back/forward always agrees with the highlight.
 */
export function SidebarSessions() {
  const {
    sessions,
    sessionsStatus,
    sessionsError,
    reloadSessions,
  } = useWorkspace();
  const goToConsole = useGoToConsole();
  const pathname = usePathname();

  const activeSessionId =
    pathname && pathname.startsWith("/session/")
      ? decodeURIComponent(pathname.slice("/session/".length))
      : null;

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [results, setResults] = useState<{ query: string; items: Session[] } | null>(null);
  const [searchError, setSearchError] = useState<{ query: string; message: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const trimmed = query.trim();
    const timer = setTimeout(() => setDebouncedQuery(trimmed), 250);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!debouncedQuery) return;

    let active = true;
    searchSessions(debouncedQuery)
      .then((items) => {
        if (!active) return;
        setResults({ query: debouncedQuery, items });
        setSearchError(null);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setSearchError({
          query: debouncedQuery,
          message: err instanceof Error ? err.message : "Search failed.",
        });
        setResults(null);
      });

    return () => {
      active = false;
    };
  }, [debouncedQuery]);

  // Derived instead of set inside the effect: a search is "in flight"
  // until results for the current query arrive.
  const searchingActive = debouncedQuery.length > 0;
  const searching = searchingActive && results?.query !== debouncedQuery;
  const currentError = searchError?.query === debouncedQuery ? searchError.message : null;
  const listSessions = searchingActive
    ? results?.query === debouncedQuery
      ? results.items
      : []
    : sessions;

  function clearSearch() {
    setQuery("");
    setDebouncedQuery("");
    inputRef.current?.focus();
  }

  return (
    <section aria-label="Sessions">
      <div className="relative mb-2">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint"
        />
        <Input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && query) {
              e.preventDefault();
              clearSearch();
            }
          }}
          placeholder="Search sessions…"
          aria-label="Search sessions"
          className="h-8 rounded-lg bg-background pr-8 pl-8 text-[13px]"
        />
        {query ? (
          <button
            type="button"
            onClick={clearSearch}
            aria-label="Clear search"
            className="absolute top-1/2 right-1.5 size-6 -translate-y-1/2 rounded-md text-faint transition-colors duration-[150ms] hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
          >
            <X className="mx-auto size-3.5" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <SectionHeading
        aside={
          searchingActive && searching ? (
            <LoaderCircle className="size-3 animate-spin text-faint" aria-hidden="true" />
          ) : !searchingActive && sessions.length > 0 ? (
            <span className="text-[11px] text-faint tabular-nums">{sessions.length}</span>
          ) : null
        }
      >
        {searchingActive ? "Search results" : "Recent sessions"}
      </SectionHeading>

      {searching ? (
        <SkeletonRows count={2} />
      ) : currentError ? (
        <p className="px-2.5 py-2 text-[13px] text-danger" role="alert">
          {currentError}
        </p>
      ) : sessionsStatus === "loading" && sessions.length === 0 && !searchingActive ? (
        <SkeletonRows />
      ) : sessionsStatus === "error" && sessions.length === 0 && !searchingActive ? (
        <div className="px-2.5 py-2">
          <p className="text-[13px] text-subtle">{sessionsError}</p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={reloadSessions}
            className="mt-1.5 text-faint hover:text-foreground"
          >
            <RefreshCw aria-hidden="true" /> Retry
          </Button>
        </div>
      ) : listSessions.length === 0 && searchingActive ? (
        <p className="px-2.5 py-2 text-[13px] text-faint">
          No sessions match “{debouncedQuery}”.
        </p>
      ) : listSessions.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-3 py-4 text-center">
          <p className="text-[13px] text-subtle">No sessions yet</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={goToConsole}
            className="mt-2.5"
          >
            <Plus aria-hidden="true" />
            Start a new session
          </Button>
        </div>
      ) : (
        <ul className="space-y-0.5">
          {listSessions.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              active={activeSessionId === session.id}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
