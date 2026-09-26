"use client";

import { useRef } from "react";
import { motion, useInView } from "framer-motion";
import { CircleCheck, GitBranch, PencilLine, ScanSearch } from "lucide-react";

import { usePrefersReducedMotion } from "@/app/lib/hooks";

const EASE = [0.16, 1, 0.3, 1] as const;

function ConnectionLine({ vertical }: { vertical?: boolean }) {
  const reduced = usePrefersReducedMotion();

  if (vertical) {
    return (
      <div className="flex justify-center py-1" aria-hidden="true">
        <div
          data-scroll-line="v"
          className="relative h-8 w-px bg-gradient-to-b from-transparent via-border to-transparent"
        >
          {!reduced && (
            <div
              className="absolute left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-foreground/25"
              style={{ animation: "glow-dot-vertical 2.4s linear infinite" }}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="hidden items-center md:flex" aria-hidden="true">
      <div
        data-scroll-line="h"
        className="relative h-px w-6 bg-gradient-to-r from-transparent via-border to-transparent xl:w-8"
      >
        {!reduced && (
          <div
            className="absolute top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-foreground/25"
            style={{ animation: "glow-dot 2.4s linear infinite" }}
          />
        )}
      </div>
    </div>
  );
}

const STEPS = [
  {
    step: "01",
    title: "Connect a repository",
    description: "Sign in with GitHub and pick the repo to work on.",
    icon: GitBranch,
    visual: (
      <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-2">
        <GitBranch className="size-3.5 text-muted-foreground" />
        <span className="truncate font-mono text-[11px] text-foreground/85">
          arav-menon/klinpi
        </span>
      </div>
    ),
  },
  {
    step: "02",
    title: "Describe the task",
    description: "An issue, a bug report, or a plain sentence.",
    icon: PencilLine,
    visual: (
      <div className="rounded-md border border-border bg-background px-2.5 py-2 font-mono text-[11px] leading-relaxed">
        <span className="text-success">❯</span>{" "}
        <span className="text-foreground/85">Fix #234 — token refresh</span>
        <span className="ml-0.5 inline-block h-3 w-1.5 animate-caret bg-foreground/60 align-middle" />
      </div>
    ),
  },
  {
    step: "03",
    title: "It explores the code",
    description: "The agent reads files and traces the relevant path.",
    icon: ScanSearch,
    visual: (
      <div className="space-y-1 font-mono text-[11px]">
        <p className="rounded border border-border bg-background px-2 py-1 text-muted-foreground">
          list_files /workspace
        </p>
        <p className="rounded border border-border bg-background px-2 py-1 text-foreground/85">
          read_file lib/jwt.ts
        </p>
      </div>
    ),
  },
  {
    step: "04",
    title: "It works in a sandbox",
    description: "Files are edited in an isolated cloud environment.",
    icon: PencilLine,
    visual: (
      <div className="space-y-0.5 rounded-md border border-border bg-background px-2.5 py-2 font-mono text-[11px]">
        <p className="truncate text-danger/90">− isExpired(payload)</p>
        <p className="truncate text-success">+ shouldRefresh(payload)</p>
        <p className="truncate text-success">+ continueWithFresh(…)</p>
      </div>
    ),
  },
  {
    step: "05",
    title: "You review the result",
    description: "A changed file and the reasoning behind it.",
    icon: CircleCheck,
    visual: (
      <div className="flex items-center gap-2 rounded-md border border-success/25 bg-success/10 px-2.5 py-2">
        <CircleCheck className="size-3.5 shrink-0 text-success" />
        <span className="font-mono text-[11px] text-success">
          1 file changed · ready
        </span>
      </div>
    ),
  },
];

function StepCard({ index }: { index: number }) {
  const step = STEPS[index];
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  const reduced = usePrefersReducedMotion();

  return (
    <motion.div
      ref={ref}
      initial={reduced || inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 16 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.55, delay: index * 0.06, ease: EASE }}
      className="group flex-1 rounded-xl border border-border bg-surface p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-foreground/25 min-w-0"
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-[11px] tracking-widest text-faint">
          {step.step}
        </span>
        <step.icon
          className="size-4 text-muted-foreground transition-colors group-hover:text-foreground"
          aria-hidden="true"
        />
      </div>

      <h3 className="text-sm font-medium text-foreground">{step.title}</h3>
      <p className="mt-1 mb-4 text-xs leading-relaxed text-muted-foreground">
        {step.description}
      </p>

      <div className="min-h-[3.5rem]">{step.visual}</div>
    </motion.div>
  );
}

export default function Workflow() {
  const reduced = usePrefersReducedMotion();

  return (
    <section id="workflow" className="scroll-mt-24 py-20 md:py-28">
      <div className="container">
        <motion.div
          initial={reduced ? { opacity: 1 } : { opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.6, ease: EASE }}
          className="mx-auto mb-14 max-w-2xl text-center"
        >
          <p className="font-mono text-[11px] tracking-widest text-subtle uppercase">
            Workflow
          </p>
          <h2 className="text-balance mt-4 text-3xl font-semibold tracking-[-0.03em] text-foreground md:text-4xl">
            Give it a task. Let it work.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-muted-foreground">
            Klinpi takes a repository and a task, inspects the code, edits it
            inside a sandbox and reports back — with every step visible while
            it happens.
          </p>
        </motion.div>

        {/* Wide screens: horizontal timeline */}
        <div className="hidden xl:block">
          <div className="flex items-stretch">
            <StepCard index={0} />
            <ConnectionLine />
            <StepCard index={1} />
            <ConnectionLine />
            <StepCard index={2} />
            <ConnectionLine />
            <StepCard index={3} />
            <ConnectionLine />
            <StepCard index={4} />
          </div>
        </div>

        {/* Narrower screens: vertical stack */}
        <div className="xl:hidden">
          <div className="flex flex-col items-stretch">
            {STEPS.map((_, index) => (
              <div key={index} className="flex flex-col">
                <StepCard index={index} />
                {index < STEPS.length - 1 && <ConnectionLine vertical />}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
