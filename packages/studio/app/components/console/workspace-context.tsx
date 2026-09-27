"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";

import {
  consolePath,
  listGithubRepos,
  listRecentSessions,
  type GithubRepo,
  type Session,
} from "@/lib/api";
import type { CurrentUser } from "@/app/lib/current-user";

export type LoadStatus = "loading" | "ready" | "error";
export type ReposStatus = LoadStatus | "disconnected";

interface WorkspaceContextValue {
  user: CurrentUser;

  /** Recent sessions for the signed-in user, newest first. */
  sessions: Session[];
  sessionsStatus: LoadStatus;
  sessionsError: string | null;
  reloadSessions: () => void;

  /**
   * Session backing the current route (`/session/[sessionId]`), loaded by
   * the session guard — or null on the console (new-session workspace).
   */
  activeSession: Session | null;

  /** GitHub repositories (live, via the gateway proxy). */
  repos: GithubRepo[];
  reposStatus: ReposStatus;
  reposError: string | null;
  reloadRepos: () => void;

  /** Locally selected repository context for the workspace header. */
  selectedRepo: GithubRepo | null;
  selectRepo: (repo: GithubRepo | null) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function byUpdatedAtDesc(a: Session, b: Session) {
  return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
}

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

export function WorkspaceProvider({
  user,
  activeSession = null,
  children,
}: {
  user: CurrentUser;
  activeSession?: Session | null;
  children: ReactNode;
}) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionsStatus, setSessionsStatus] = useState<LoadStatus>("loading");
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [sessionsVersion, setSessionsVersion] = useState(0);

  const [repos, setRepos] = useState<GithubRepo[]>([]);
  const [reposStatus, setReposStatus] = useState<ReposStatus>("loading");
  const [reposError, setReposError] = useState<string | null>(null);
  const [reposVersion, setReposVersion] = useState(0);

  const [selectedRepo, setSelectedRepo] = useState<GithubRepo | null>(null);

  const reloadSessions = useCallback(() => {
    setSessionsStatus("loading");
    setSessionsVersion((v) => v + 1);
  }, []);
  const reloadRepos = useCallback(() => {
    setReposStatus("loading");
    setReposVersion((v) => v + 1);
  }, []);
  const selectRepo = useCallback((repo: GithubRepo | null) => setSelectedRepo(repo), []);

  useEffect(() => {
    let active = true;

    listRecentSessions(20)
      .then(({ sessions: items }) => {
        if (!active) return;
        setSessions([...items].sort(byUpdatedAtDesc));
        setSessionsError(null);
        setSessionsStatus("ready");
      })
      .catch((err: unknown) => {
        if (!active) return;
        setSessionsError(errorMessage(err, "Couldn't load sessions."));
        setSessionsStatus("error");
      });

    return () => {
      active = false;
    };
  }, [sessionsVersion]);

  useEffect(() => {
    let active = true;

    listGithubRepos()
      .then((result) => {
        if (!active) return;
        if (result.connected) {
          setRepos(result.repos);
          setReposError(null);
          setReposStatus("ready");
        } else {
          setRepos([]);
          setReposError(null);
          setReposStatus("disconnected");
        }
      })
      .catch((err: unknown) => {
        if (!active) return;
        setReposError(errorMessage(err, "Couldn't load repositories."));
        setReposStatus("error");
      });

    return () => {
      active = false;
    };
  }, [reposVersion]);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      user,
      sessions,
      sessionsStatus,
      sessionsError,
      reloadSessions,
      activeSession,
      repos,
      reposStatus,
      reposError,
      reloadRepos,
      selectedRepo,
      selectRepo,
    }),
    [
      user,
      sessions,
      sessionsStatus,
      sessionsError,
      reloadSessions,
      activeSession,
      repos,
      reposStatus,
      reposError,
      reloadRepos,
      selectedRepo,
      selectRepo,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside a WorkspaceProvider");
  return ctx;
}

/**
 * "New session" navigation: go to the console (sessions are created by
 * submitting the first prompt, not by an empty-state API call). Already
 * on the console → focus the composer instead of navigating.
 */
export function useGoToConsole() {
  const { user } = useWorkspace();
  const router = useRouter();
  const pathname = usePathname();

  return useCallback(() => {
    if (pathname?.startsWith("/console/")) {
      document.getElementById("console-composer")?.focus();
      return;
    }
    router.push(consolePath(user.id));
  }, [pathname, router, user.id]);
}
