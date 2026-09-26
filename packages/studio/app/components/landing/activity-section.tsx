"use client";

import { useRef, useState } from "react";
import { motion, useInView } from "framer-motion";
import { Radio, RefreshCw } from "lucide-react";

import ActivityStream from "@/app/components/landing/activity-stream";
import { Button } from "@/app/components/ui/button";
import { DEMO_FEED, type AgentEventType } from "@/app/lib/agent-demo";
import { usePrefersReducedMotion, useSequence } from "@/app/lib/hooks";

const EASE = [0.16, 1, 0.3, 1] as const;

const EVENT_LEGEND: { type: AgentEventType; meaning: string }[] = [
  { type: "AGENT_STATUS", meaning: "run lifecycle updates" },
  { type: "TOOL_CALL", meaning: "an action the agent invokes" },
  { type: "TOOL_RESULT", meaning: "what the sandbox returned" },
  { type: "AGENT_MESSAGE", meaning: "the agent's explanation" },
  { type: "AGENT_ERROR", meaning: "the run stopped early" },
  { type: "AGENT_COMPLETED", meaning: "changes are ready" },
];

export default function ActivitySection() {
  const reduced = usePrefersReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const [runKey, setRunKey] = useState(0);
  const count = useSequence(DEMO_FEED, { enabled: inView, runKey });
  const done = count >= DEMO_FEED.length;

  return (
    <section id="activity" className="scroll-mt-24 py-20 md:py-28">
      <div className="container">
        <div className="grid items-start gap-12 lg:grid-cols-2 lg:gap-16">
          {/* Copy + legend */}
          <motion.div
            initial={reduced ? { opacity: 1 } : { opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.6, ease: EASE }}
          >
            <p className="font-mono text-[11px] tracking-widest text-subtle uppercase">
              Live activity
            </p>
            <h2 className="text-balance mt-4 text-3xl font-semibold tracking-[-0.03em] text-foreground md:text-4xl">
              Every step, as it happens.
            </h2>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-muted-foreground">
              A Klinpi run is a stream of events, not a spinner. Status
              changes, tool calls, tool results and the agent&apos;s own
              reasoning arrive as they occur, so you can follow the work
              instead of waiting for it.
            </p>

            <ul className="mt-8 divide-y divide-border/70 overflow-hidden rounded-xl border border-border bg-surface">
              {EVENT_LEGEND.map((item) => (
                <li
                  key={item.type}
                  className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
                >
                  <code className="shrink-0 font-mono text-[11px] tracking-wide text-foreground/85 sm:w-40">
                    {item.type}
                  </code>
                  <span className="text-xs text-muted-foreground">
                    {item.meaning}
                  </span>
                </li>
              ))}
            </ul>
          </motion.div>

          {/* Event feed */}
          <motion.div
            ref={ref}
            initial={reduced ? { opacity: 1 } : { opacity: 0, y: 20 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.7, delay: 0.08, ease: EASE }}
            className="dark-scope overflow-hidden rounded-2xl border border-border bg-surface shadow-[0_32px_90px_-48px_rgba(15,15,20,0.22)] lg:sticky lg:top-24"
          >
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <Radio
                className={`size-4 ${done ? "text-muted-foreground" : "text-success"}`}
                aria-hidden="true"
              />
              <p className="font-mono text-[11px] tracking-widest text-white/55 uppercase">
                agent events
              </p>
              <span
                className={`ml-auto inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[11px] ${
                  done
                    ? "border-border bg-muted text-muted-foreground"
                    : "border-success/30 bg-success/10 text-success"
                }`}
              >
                <span
                  className={`size-1.5 rounded-full ${
                    done ? "bg-muted-foreground" : "animate-pulse-soft bg-success"
                  }`}
                />
                {done ? "idle" : "streaming"}
              </span>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setRunKey((key) => key + 1)}
                aria-label="Replay event stream"
                className="text-muted-foreground"
              >
                <RefreshCw className="size-3" />
              </Button>
            </div>

            <div
              data-lenis-prevent
              className="max-h-[26rem] overflow-y-auto panel-grid"
            >
              <ActivityStream events={DEMO_FEED} count={count} />
              {count === 0 && (
                <p className="px-4 py-6 text-sm text-muted-foreground">
                  Connecting to session…
                </p>
              )}
            </div>

            <div className="flex items-center gap-4 border-t border-border bg-surface-raised/60 px-4 py-2.5 font-mono text-[11px] text-white/55">
              <span>ws · session s_8f2a</span>
              <span className="ml-auto">
                {count}/{DEMO_FEED.length} events
              </span>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
