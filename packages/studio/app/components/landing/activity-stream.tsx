"use client";

import { motion } from "framer-motion";
import {
  Check,
  CircleAlert,
  CircleCheck,
  Info,
  LoaderCircle,
  Wrench,
} from "lucide-react";

import {
  EVENT_LABELS,
  type AgentEvent,
  type AgentEventType,
} from "@/app/lib/agent-demo";
import { usePrefersReducedMotion } from "@/app/lib/hooks";

const EASE = [0.16, 1, 0.3, 1] as const;

const TYPE_STYLE: Record<
  AgentEventType,
  { icon: typeof Check; className: string }
> = {
  AGENT_STATUS: { icon: Info, className: "text-muted-foreground" },
  AGENT_MESSAGE: { icon: Info, className: "text-muted-foreground" },
  TOOL_CALL: { icon: Wrench, className: "text-foreground/70" },
  TOOL_RESULT: { icon: Check, className: "text-success" },
  AGENT_ERROR: { icon: CircleAlert, className: "text-danger" },
  AGENT_COMPLETED: { icon: CircleCheck, className: "text-success" },
};

function ToolCallRow({ event }: { event: AgentEvent }) {
  const call = event.toolCall;
  if (!call) return null;

  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="font-mono text-[13px] font-medium text-foreground">
        {call.name}
      </span>
      {Object.entries(call.arguments).map(([key, value]) => (
        <span
          key={key}
          className="max-w-full truncate rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
        >
          {key}=<span className="text-foreground/80">{value}</span>
        </span>
      ))}
    </div>
  );
}

function EventBody({ event }: { event: AgentEvent }) {
  if (event.toolCall) return <ToolCallRow event={event} />;

  if (event.toolResult) {
    return (
      <p className="mt-1 font-mono text-[13px] break-words text-muted-foreground">
        {event.toolResult.output}
      </p>
    );
  }

  if (event.type === "AGENT_MESSAGE") {
    return (
      <p className="mt-1 border-l border-border pl-3 text-[13px] leading-relaxed text-foreground/85">
        {event.content}
      </p>
    );
  }

  if (event.type === "AGENT_STATUS") {
    return (
      <div className="mt-1 flex items-center gap-2">
        <LoaderCircle className="size-3.5 animate-spin-slow text-muted-foreground" />
        <span className="font-mono text-[13px] text-muted-foreground">
          {event.content}
        </span>
      </div>
    );
  }

  return (
    <p className="mt-1 font-mono text-[13px] text-foreground/85">
      {event.content}
    </p>
  );
}

interface ActivityStreamProps {
  events: readonly AgentEvent[];
  /** Number of events currently revealed. */
  count: number;
  className?: string;
}

export default function ActivityStream({
  events,
  count,
  className,
}: ActivityStreamProps) {
  const reduced = usePrefersReducedMotion();
  const visible = events.slice(0, count);

  return (
    <ol className={className}>
      {visible.map((event) => {
        const meta = TYPE_STYLE[event.type];
        const Icon = meta.icon;

        return (
          <motion.li
            key={event.id}
            initial={
              reduced
                ? false
                : {
                    opacity: 0,
                    y: 6,
                    backgroundColor: "rgba(255, 255, 255, 0.06)",
                  }
            }
            animate={{
              opacity: 1,
              y: 0,
              backgroundColor: "rgba(255, 255, 255, 0)",
            }}
            transition={{ duration: 0.4, ease: EASE }}
            className="flex gap-3 border-b border-border/60 px-4 py-3 last:border-b-0"
          >
            <Icon
              className={`mt-0.5 size-4 shrink-0 ${meta.className}`}
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-[11px] tracking-wider text-white/55 uppercase">
                  {EVENT_LABELS[event.type]}
                </span>
                <time className="ml-auto shrink-0 font-mono text-[11px] text-white/50">
                  {event.timestamp}
                </time>
              </div>
              <EventBody event={event} />
            </div>
          </motion.li>
        );
      })}
    </ol>
  );
}
