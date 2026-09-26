"use client";

import Link from "next/link";
import { Fragment } from "react";
import { motion } from "framer-motion";

import AgentWorkspace from "@/app/components/landing/agent-workspace";
import { GitHubIcon } from "@/app/components/landing/icons";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { usePrefersReducedMotion } from "@/app/lib/hooks";

const EASE = [0.16, 1, 0.3, 1] as const;

const CAPABILITIES = [
  "GitHub repositories",
  "Isolated cloud sandbox",
  "Real file edits",
  "Streamed agent events",
];

export default function Hero() {
  const reduced = usePrefersReducedMotion();

  const rise = (delay: number) => ({
    initial: reduced ? { opacity: 1 } : { opacity: 0, y: 16 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.7, delay: reduced ? 0 : delay, ease: EASE },
  });

  return (
    <section className="relative overflow-hidden pb-20 pt-28 sm:pt-32 md:pb-28 md:pt-40">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[36rem] bg-glow-hero"
        aria-hidden="true"
      />

      <div className="container">
        <div className="mx-auto max-w-3xl text-center">
          <motion.div {...rise(0)}>
            <Badge
              variant="outline"
              className="gap-2 rounded-full border-border bg-muted/60 px-3 text-muted-foreground"
            >
              <span className="size-1.5 rounded-full bg-success" />
              Cloud coding agent
            </Badge>
          </motion.div>

          <motion.h1
            {...rise(0.08)}
            className="text-balance mt-6 text-4xl font-semibold tracking-[-0.035em] text-foreground sm:text-5xl md:text-6xl lg:text-[4.25rem] lg:leading-[1.03]"
          >
            Your AI engineer, built to work on your code.
          </motion.h1>

          <motion.p
            {...rise(0.16)}
            className="mx-auto mt-5 max-w-2xl text-balance text-base leading-relaxed text-muted-foreground sm:text-lg"
          >
            Connect a GitHub repository, hand Klinpi a task, and the agent
            reads the code, edits files and runs the work in an isolated cloud
            sandbox — streaming every step back to you.
          </motion.p>

          <motion.div
            {...rise(0.24)}
            className="mt-8 flex flex-wrap items-center justify-center gap-3"
          >
            <Button size="lg" className="rounded-lg px-6 hover:-translate-y-px" asChild>
              <Link href="/signup">Start building</Link>
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="rounded-lg px-6 text-muted-foreground hover:-translate-y-px"
              asChild
            >
              <a
                href="https://github.com/Arav-Menon/klinPi"
                target="_blank"
                rel="noopener noreferrer"
              >
                <GitHubIcon />
                Star on GitHub
              </a>
            </Button>
          </motion.div>

          <motion.p
            {...rise(0.3)}
            className="mt-6 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 font-mono text-[11px] tracking-wide text-subtle uppercase"
          >
            <span>GitHub sign-in</span>
            <span aria-hidden="true" className="text-faint/70">
              /
            </span>
            <span>Sandboxed execution</span>
            <span aria-hidden="true" className="text-faint/70">
              /
            </span>
            <span>Live agent events</span>
          </motion.p>
        </div>

        <div className="mt-14 md:mt-20" data-parallax="demo">
          <AgentWorkspace />
        </div>

          <motion.div
            {...rise(0.55)}
            className="mt-10 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-muted-foreground"
          >
          {CAPABILITIES.map((capability, index) => (
            <Fragment key={capability}>
              {index > 0 && (
                <span aria-hidden="true" className="text-faint/60">
                  ·
                </span>
              )}
              <span>{capability}</span>
            </Fragment>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
