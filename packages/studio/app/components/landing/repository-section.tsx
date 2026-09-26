"use client";

import { useRef } from "react";
import { motion, useInView } from "framer-motion";
import { Check, GitBranch, Star, Terminal } from "lucide-react";

import { GitHubIcon } from "@/app/components/landing/icons";
import { usePrefersReducedMotion } from "@/app/lib/hooks";

const EASE = [0.16, 1, 0.3, 1] as const;

const REPOSITORIES = [
  {
    full_name: "arav-menon/klinpi",
    language: "TypeScript",
    color: "bg-sky-400",
    branch: "main",
    updated: "2h ago",
    selected: true,
  },
  {
    full_name: "arav-menon/playground",
    language: "JavaScript",
    color: "bg-amber-400",
    branch: "main",
    updated: "yesterday",
  },
  {
    full_name: "arav-menon/infra-scripts",
    language: "Shell",
    color: "bg-emerald-400",
    branch: "master",
    updated: "4d ago",
  },
];

const POINTS = [
  "Sign in with GitHub — no extra credentials to manage",
  "Your repository list, pulled live from your GitHub account",
  "The chosen repo is cloned into the sandbox at /workspace",
];

export default function RepositorySection() {
  const reduced = usePrefersReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section id="repository" className="scroll-mt-24 py-20 md:py-28">
      <div className="container">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-20">
          {/* Copy */}
          <motion.div
            initial={reduced ? { opacity: 1 } : { opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.6, ease: EASE }}
          >
            <p className="font-mono text-[11px] tracking-widest text-subtle uppercase">
              Repository
            </p>
            <h2 className="text-balance mt-4 text-3xl font-semibold tracking-[-0.03em] text-foreground md:text-4xl">
              It starts with your repository.
            </h2>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-muted-foreground">
              Sign in with GitHub, pick a repository, and Klinpi clones it into
              the session sandbox. The agent works against your actual
              codebase — not a paste of it.
            </p>

            <ul className="mt-8 space-y-4">
              {POINTS.map((point) => (
                <li key={point} className="flex gap-3">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-muted">
                    <Check className="size-3 text-foreground/80" />
                  </span>
                  <span className="text-sm leading-relaxed text-muted-foreground">
                    {point}
                  </span>
                </li>
              ))}
            </ul>
          </motion.div>

          {/* Repository picker */}
          <motion.div
            ref={ref}
            initial={reduced ? { opacity: 1 } : { opacity: 0, y: 20 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.7, ease: EASE }}
            className="dark-scope overflow-hidden rounded-2xl border border-border bg-surface shadow-[0_32px_90px_-48px_rgba(15,15,20,0.22)]"
          >
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <GitHubIcon className="size-4 text-muted-foreground" />
              <p className="text-xs font-medium text-foreground">
                Select a repository
              </p>
              <span className="ml-auto rounded-md border border-border bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground">
                GET /user/repos
              </span>
            </div>

            <ul>
              {REPOSITORIES.map((repo, index) => (
                <motion.li
                  key={repo.full_name}
                  initial={reduced || !inView ? false : { opacity: 0, x: -8 }}
                  animate={inView ? { opacity: 1, x: 0 } : {}}
                  transition={{
                    duration: 0.45,
                    delay: 0.15 + index * 0.09,
                    ease: EASE,
                  }}
                  className={`flex items-center gap-3 border-b border-border/70 px-4 py-3 ${
                    repo.selected ? "bg-muted/70" : ""
                  }`}
                >
                  <span
                    className={`flex size-6 shrink-0 items-center justify-center rounded-full border ${
                      repo.selected
                        ? "border-success/40 bg-success/15 text-success"
                        : "border-border bg-background text-white/45"
                    }`}
                  >
                    {repo.selected ? (
                      <Check className="size-3" />
                    ) : (
                      <GitHubIcon className="size-3" />
                    )}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-xs text-foreground">
                      {repo.full_name}
                    </p>
                    <p className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <span className={`size-2 rounded-full ${repo.color}`} />
                        {repo.language}
                      </span>
                      <span className="flex items-center gap-1">
                        <GitBranch className="size-3" />
                        {repo.branch}
                      </span>
                    </p>
                  </div>

                  <span className="shrink-0 text-[11px] text-white/50">
                    {repo.updated}
                  </span>
                </motion.li>
              ))}
            </ul>

            <div className="flex items-center justify-center gap-2 py-3">
              <span className="h-px w-6 bg-gradient-to-r from-transparent to-white/20" />
              <span className="rounded-full border border-border bg-background px-2.5 py-1 font-mono text-[11px] text-muted-foreground">
                clone into sandbox
              </span>
              <span className="h-px w-6 bg-gradient-to-l from-transparent to-white/20" />
            </div>

            <div className="border-t border-border bg-background/60 px-4 py-3">
              <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2.5">
                <Terminal className="size-3.5 shrink-0 text-success" />
                <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground/85">
                  git clone --branch main github.com/arav-menon/klinpi.git
                  /workspace
                </code>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-white/55">
                <span className="flex items-center gap-1.5">
                  <Star className="size-3" /> 1 repository connected
                </span>
                <span>status: RUNNING</span>
                <span className="text-success">/workspace ready</span>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
