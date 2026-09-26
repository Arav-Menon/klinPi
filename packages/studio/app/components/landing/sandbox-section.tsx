"use client";

import { motion } from "framer-motion";
import {
  Braces,
  CircleCheck,
  Container,
  FileDiff,
  GitBranch,
} from "lucide-react";

import { usePrefersReducedMotion } from "@/app/lib/hooks";

const EASE = [0.16, 1, 0.3, 1] as const;

const NODES = [
  { icon: GitBranch, label: "Repository", sub: "github.com" },
  { icon: Braces, label: "Klinpi agent", sub: "reads · plans · edits" },
  { icon: Container, label: "Cloud sandbox", sub: "/workspace", isolated: true },
  { icon: FileDiff, label: "Code changes", sub: "1 file" },
  { icon: CircleCheck, label: "Result", sub: "ready to review" },
];

const FACTS = [
  { label: "Isolated", value: "one sandbox per session" },
  { label: "Workspace", value: "/workspace" },
  { label: "Lifetime", value: "30 min, extended while running" },
  { label: "Teardown", value: "destroyed after the run" },
];

function FlowLine({ vertical }: { vertical?: boolean }) {
  const reduced = usePrefersReducedMotion();

  if (vertical) {
    return (
      <div className="flex justify-center py-1" aria-hidden="true">
        <div
          data-scroll-line="v"
          className="relative h-6 w-px bg-gradient-to-b from-transparent via-border to-transparent"
        >
          {!reduced && (
            <div
              className="absolute left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-foreground/30"
              style={{ animation: "glow-dot-vertical 2s linear infinite" }}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="hidden flex-1 items-center md:flex" aria-hidden="true">
      <div
        data-scroll-line="h"
        className="relative h-px w-full bg-gradient-to-r from-transparent via-border to-transparent"
      >
        {!reduced && (
          <div
            className="absolute top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-foreground/30"
            style={{ animation: "glow-dot 2s linear infinite" }}
          />
        )}
      </div>
    </div>
  );
}

function FlowNode({ index }: { index: number }) {
  const node = NODES[index];
  const body = (
    <div className="flex w-full min-w-0 flex-col items-center gap-1.5 px-2 py-3 text-center md:px-3">
      <span className="flex size-9 items-center justify-center rounded-lg border border-border bg-muted text-foreground/80">
        <node.icon className="size-4" aria-hidden="true" />
      </span>
      <p className="text-xs font-medium text-foreground">{node.label}</p>
      <p className="max-w-full truncate font-mono text-[10px] text-muted-foreground">
        {node.sub}
      </p>
    </div>
  );

  if (!node.isolated) {
    return (
      <div className="w-full rounded-xl border border-border bg-surface md:w-auto md:flex-1">
        {body}
      </div>
    );
  }

  return (
    <div className="w-full md:w-auto md:flex-1">
      <div className="rounded-xl border border-dashed border-success/35 bg-success/[0.04] p-1.5">
        <p className="mb-1 text-center font-mono text-[10px] tracking-wider text-success/80 uppercase">
          isolated
        </p>
        <div className="rounded-lg border border-border bg-surface">
          {body}
        </div>
      </div>
    </div>
  );
}

export default function SandboxSection() {
  const reduced = usePrefersReducedMotion();

  return (
    <section id="sandbox" className="scroll-mt-24 py-20 md:py-28">
      <div className="container">
        <div className="grid items-center gap-12 lg:grid-cols-[1.15fr_1fr] lg:gap-16">
          {/* Pipeline visual */}
          <motion.div
            initial={reduced ? { opacity: 1 } : { opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.7, ease: EASE }}
            className="rounded-2xl border border-border bg-surface/70 p-4 sm:p-6"
          >
            <div className="mb-5 flex items-center justify-between gap-3">
              <p className="font-mono text-[11px] tracking-widest text-subtle uppercase">
                Execution path
              </p>
              <span className="rounded-md border border-border bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground">
                per session
              </span>
            </div>

            {/* Desktop: horizontal chain */}
            <div className="hidden items-center md:flex">
              <FlowNode index={0} />
              <FlowLine />
              <FlowNode index={1} />
              <FlowLine />
              <FlowNode index={2} />
              <FlowLine />
              <FlowNode index={3} />
              <FlowLine />
              <FlowNode index={4} />
            </div>

            {/* Mobile: vertical chain */}
            <div className="flex flex-col items-stretch md:hidden">
              {NODES.map((_, index) => (
                <div key={index} className="flex flex-col">
                  <FlowNode index={index} />
                  {index < NODES.length - 1 && <FlowLine vertical />}
                </div>
              ))}
            </div>

            <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border pt-5">
              {FACTS.map((fact) => (
                <div key={fact.label}>
                  <dt className="font-mono text-[10px] tracking-wider text-subtle uppercase">
                    {fact.label}
                  </dt>
                  <dd className="mt-0.5 text-xs text-muted-foreground">
                    {fact.value}
                  </dd>
                </div>
              ))}
            </dl>
          </motion.div>

          {/* Copy */}
          <motion.div
            initial={reduced ? { opacity: 1 } : { opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.6, delay: 0.08, ease: EASE }}
          >
            <p className="font-mono text-[11px] tracking-widest text-subtle uppercase">
              Sandbox
            </p>
            <h2 className="text-balance mt-4 text-3xl font-semibold tracking-[-0.03em] text-foreground md:text-4xl">
              A real environment, not a chat window.
            </h2>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-muted-foreground">
              Each session gets its own isolated cloud sandbox. The repository
              is cloned into it, the agent reads and edits files there, and the
              work stays contained — nothing runs on your machine.
            </p>

            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              {[
                {
                  title: "Isolated by default",
                  body: "No shared state between sessions.",
                },
                {
                  title: "Real files",
                  body: "Edits land on the cloned working tree.",
                },
                {
                  title: "Ephemeral",
                  body: "The sandbox expires when the run ends.",
                },
                {
                  title: "Observable",
                  body: "Every command and file change is visible.",
                },
              ].map((item) => (
                <div
                  key={item.title}
                  className="rounded-xl border border-border bg-surface p-4"
                >
                  <p className="text-sm font-medium text-foreground">
                    {item.title}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {item.body}
                  </p>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
