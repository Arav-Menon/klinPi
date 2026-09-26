"use client";

import Link from "next/link";
import { motion } from "framer-motion";

import { GitHubIcon } from "@/app/components/landing/icons";
import { Button } from "@/app/components/ui/button";
import { usePrefersReducedMotion } from "@/app/lib/hooks";

const EASE = [0.16, 1, 0.3, 1] as const;

export default function Cta() {
  const reduced = usePrefersReducedMotion();

  return (
    <section className="py-20 md:py-28">
      <div className="container">
        <motion.div
          initial={reduced ? { opacity: 1 } : { opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.6, ease: EASE }}
          className="relative mx-auto max-w-3xl overflow-hidden rounded-3xl border border-border bg-surface px-6 py-14 text-center sm:px-12"
        >
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-glow-hero"
            aria-hidden="true"
          />

          <p className="font-mono text-[11px] tracking-widest text-subtle uppercase">
            Get started
          </p>
          <h2 className="text-balance mt-4 text-3xl font-semibold tracking-[-0.03em] text-foreground md:text-4xl">
            Give your repository a task.
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-base leading-relaxed text-muted-foreground">
            Klinpi is in active development. Create an account and follow a run
            from task to changed file.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
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
          </div>

          <p className="mt-6 font-mono text-[11px] tracking-wide text-subtle uppercase">
            open source · typescript · self-hostable
          </p>
        </motion.div>
      </div>
    </section>
  );
}
