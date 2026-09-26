"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useInView } from "framer-motion";
import { FileText, FolderGit2, GitBranch, RefreshCw } from "lucide-react";

import ActivityStream from "@/app/components/landing/activity-stream";
import { LogoMark } from "@/app/components/landing/logo";
import { Button } from "@/app/components/ui/button";
import {
  DEMO_EVENTS,
  DEMO_FILE_TREE,
  DEMO_REPOSITORY,
  DEMO_SESSIONS,
  DEMO_TASK,
  DEMO_TERMINAL,
} from "@/app/lib/agent-demo";
import { usePrefersReducedMotion, useSequence } from "@/app/lib/hooks";

const EASE = [0.16, 1, 0.3, 1] as const;

const DIFF_LINES: { prefix: " " | "+" | "-"; text: string }[] = [
  { prefix: " ", text: "const payload = verifyToken(token)" },
  { prefix: "-", text: "if (isExpired(payload)) return refresh(req, res)" },
  { prefix: "+", text: "if (shouldRefresh(payload)) {" },
  { prefix: "+", text: "  const fresh = await refreshSession(req, res)" },
  { prefix: "+", text: "  return continueWithFreshCookie(req, res)" },
  { prefix: "+", text: "}" },
  { prefix: " ", text: "return proceed(req, res)" },
];

const TERMINAL_TONE: Record<string, string> = {
  cmd: "text-foreground/85",
  out: "text-muted-foreground",
  ok: "text-success",
  add: "text-success",
  dim: "text-white/55",
};

function useAutoScroll(count: number) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el || reduced) return;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: "smooth",
    });
  }, [count, reduced]);

  return ref;
}

function StatusChip({ done }: { done: boolean }) {
  return (
    <span
      className={`inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 font-mono text-[11px] transition-colors duration-300 ${
        done
          ? "border-success/30 bg-success/10 text-success"
          : "border-border bg-muted text-foreground/80"
      }`}
    >
      <span
        className={`size-1.5 rounded-full transition-colors duration-300 ${
          done ? "bg-success" : "animate-pulse-soft bg-warning"
        }`}
      />
      {done ? "completed" : "running"}
    </span>
  );
}

export default function AgentWorkspace() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-80px" });
  const reduced = usePrefersReducedMotion();
  const [runKey, setRunKey] = useState(0);

  const eventCount = useSequence(DEMO_EVENTS, { enabled: inView, runKey });
  const termCount = useSequence(DEMO_TERMINAL, { enabled: inView, runKey });
  const streamRef = useAutoScroll(eventCount);
  const termRef = useAutoScroll(termCount);

  const done = eventCount >= DEMO_EVENTS.length;
  const showDiff = termCount >= DEMO_TERMINAL.length;

  return (
    <div ref={ref} className="mx-auto w-full max-w-6xl">
      <motion.div
        initial={reduced ? { opacity: 1 } : { opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.8, delay: 0.4, ease: EASE }}
        className="dark-scope overflow-hidden rounded-2xl border border-border bg-surface shadow-[0_40px_120px_-56px_rgba(15,15,20,0.4)]"
      >
        {/* Window chrome */}
        <div className="flex items-center gap-3 border-b border-border bg-surface-raised/60 px-3 py-2.5 sm:px-4">
          <div className="hidden items-center gap-1.5 sm:flex" aria-hidden="true">
            <span className="size-2.5 rounded-full bg-white/12" />
            <span className="size-2.5 rounded-full bg-white/12" />
            <span className="size-2.5 rounded-full bg-white/12" />
          </div>

          <div className="flex min-w-0 items-center gap-2">
            <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate font-mono text-xs text-muted-foreground">
              {DEMO_REPOSITORY.fullName}
            </span>
            <span className="hidden rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground sm:inline">
              {DEMO_REPOSITORY.branch}
            </span>
          </div>

          <p className="hidden min-w-0 flex-1 truncate px-3 text-xs text-foreground/80 md:block">
            {DEMO_TASK}
          </p>

          <div className="ml-auto flex items-center gap-2">
            <StatusChip done={done} />
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setRunKey((key) => key + 1)}
              aria-label="Replay agent demo"
              className="text-muted-foreground"
            >
              <RefreshCw className="size-3" />
              <span className="hidden sm:inline">Replay</span>
            </Button>
          </div>
        </div>

        {/* Body */}
        <div className="grid grid-cols-1 lg:h-[34rem] lg:grid-cols-[13.5rem_minmax(0,1fr)_minmax(0,22.5rem)]">
          {/* Sidebar */}
          <aside className="hidden min-h-0 border-r border-border bg-surface/60 lg:flex lg:flex-col">
            <div className="border-b border-border p-3">
              <p className="mb-2 px-1 font-mono text-[10px] tracking-widest text-white/55 uppercase">
                Sessions
              </p>
              <ul className="space-y-0.5">
                {DEMO_SESSIONS.map((session) => (
                  <li key={session.id}>
                    <span
                      className={`block truncate rounded-md px-2 py-1.5 text-xs transition-colors duration-150 ${
                        session.active
                          ? "bg-muted text-foreground"
                          : "text-muted-foreground hover:bg-white/5 hover:text-foreground/80"
                      }`}
                      title={session.title}
                    >
                      {session.title}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="p-3">
              <p className="mb-2 px-1 font-mono text-[10px] tracking-widest text-white/55 uppercase">
                Files
              </p>
              <ul className="space-y-0.5">
                {DEMO_FILE_TREE.map((file) => (
                  <li
                    key={`${file.depth}-${file.name}`}
                    className="flex items-center gap-1.5 rounded-md transition-colors duration-150 hover:bg-white/5"
                    style={{ paddingLeft: `${file.depth * 0.75}rem` }}
                  >
                    {file.kind === "dir" ? (
                      <FolderGit2 className="size-3.5 shrink-0 text-white/45" />
                    ) : (
                      <FileText className="size-3.5 shrink-0 text-white/45" />
                    )}
                    <span
                      className={`truncate font-mono text-[11px] ${
                        file.changed
                          ? "text-foreground"
                          : "text-muted-foreground"
                      }`}
                      title={file.name}
                    >
                      {file.name}
                    </span>
                    {file.changed && (
                      <span className="ml-auto shrink-0 rounded border border-success/30 bg-success/10 px-1 font-mono text-[10px] text-success">
                        M
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </aside>

          {/* Activity column */}
          <div className="flex min-h-0 min-w-0 flex-col border-b border-border lg:border-b-0 lg:border-r">
            <div className="flex items-start gap-3 border-b border-border p-4">
              <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-muted">
                <LogoMark inverse className="h-4 w-auto" />
              </span>
              <div className="min-w-0">
                <p className="font-mono text-[11px] tracking-wider text-white/55 uppercase">
                  Task
                </p>
                <p className="mt-1 text-sm text-foreground">{DEMO_TASK}</p>
              </div>
            </div>

            <div
              ref={streamRef}
              data-lenis-prevent
              className="h-[22rem] min-h-0 flex-1 overflow-y-auto lg:h-auto"
            >
              <ActivityStream events={DEMO_EVENTS} count={eventCount} />
              {eventCount === 0 && (
                <p className="px-4 py-6 text-sm text-muted-foreground">
                  Waiting for the agent…
                </p>
              )}
            </div>

            <div className="border-t border-border p-3">
              <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/60 px-3 py-2.5">
                <span className="text-sm text-white/45">
                  Reply to Klinpi…
                </span>
                <span className="ml-auto rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px] text-white/50">
                  send
                </span>
              </div>
            </div>
          </div>

          {/* Sandbox column */}
          <div className="flex min-h-0 min-w-0 flex-col">
            <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
              <span className="size-1.5 rounded-full bg-success" />
              <p className="font-mono text-[11px] tracking-wider text-white/55 uppercase">
                sandbox · /workspace
              </p>
            </div>

            <div
              ref={termRef}
              data-lenis-prevent
              className="h-[14rem] min-h-0 overflow-y-auto bg-background/60 px-4 py-3 font-mono text-xs leading-relaxed lg:h-[15rem]"
              aria-hidden="true"
            >
              {DEMO_TERMINAL.slice(0, termCount).map((entry, index) => (
                <motion.p
                  key={index}
                  initial={reduced ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.25 }}
                  className={`break-words ${TERMINAL_TONE[entry.tone ?? "out"]}`}
                >
                  {entry.tone === "cmd" && (
                    <span className="mr-2 text-success">$</span>
                  )}
                  {entry.tone === "add" && (
                    <span className="mr-1 text-success/70">+</span>
                  )}
                  {entry.line}
                </motion.p>
              ))}
              {!done && termCount > 0 && (
                <span className="inline-block h-3.5 w-1.5 animate-caret bg-foreground/70 align-middle" />
              )}
            </div>

            <div className="border-t border-border">
              <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
                <p className="truncate font-mono text-[11px] tracking-wider text-white/55 uppercase">
                  auth.middleware.ts
                </p>
                <span className="ml-auto shrink-0 font-mono text-[11px] text-success">
                  +64
                </span>
                <span className="shrink-0 font-mono text-[11px] text-danger">
                  −4
                </span>
              </div>

              <div
                className="overflow-x-auto px-4 py-3 font-mono text-[11px] leading-6"
                aria-hidden="true"
              >
                {DIFF_LINES.map((line, index) => (
                  <motion.p
                    key={index}
                    initial={false}
                    animate={{ opacity: showDiff ? 1 : 0.25, x: showDiff ? 0 : -4 }}
                    transition={
                      reduced
                        ? { duration: 0 }
                        : {
                            duration: 0.4,
                            delay: showDiff ? index * 0.05 : 0,
                            ease: EASE,
                          }
                    }
                    className={`whitespace-pre ${
                      line.prefix === "+"
                        ? "text-success"
                        : line.prefix === "-"
                          ? "text-danger"
                          : "text-muted-foreground"
                    }`}
                  >
                    <span className="mr-2 select-none opacity-60">
                      {line.prefix}
                    </span>
                    {line.text}
                  </motion.p>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Status bar */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border bg-surface-raised/60 px-4 py-2 font-mono text-[11px] text-white/55">
          <span>session s_8f2a</span>
          <span className="hidden sm:inline">
            iterations {Math.min(Math.ceil(eventCount / 3), 10)}/10
          </span>
          <span className="ml-auto hidden sm:inline">e2b · 30m ttl</span>
          <span
            className={`transition-colors duration-300 ${
              done ? "text-success" : "text-warning"
            }`}
          >
            {done ? "● changes ready" : "● agent running"}
          </span>
        </div>
      </motion.div>

      <p className="sr-only">
        Animated preview of a Klinpi run: the agent clones the repository,
        lists files, reads jwt.ts, explains the cause of issue 234, edits
        auth.middleware.ts in the sandbox, runs the auth tests and completes
        with one changed file.
      </p>
    </div>
  );
}
