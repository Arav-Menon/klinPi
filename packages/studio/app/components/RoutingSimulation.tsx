"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { usePrefersReducedMotion } from "../lib/hooks";

interface Request {
  text: string;
  task: string;
  complexity: string;
  tools: boolean;
  model: string;
  cost: string;
}

const requests: Request[] = [
  {
    text: '"Fix auth.ts line 38"',
    task: "Coding",
    complexity: "Medium Context",
    tools: true,
    model: "Claude Sonnet",
    cost: "$0.12",
  },
  {
    text: '"Summarize README"',
    task: "Documentation",
    complexity: "Low Context",
    tools: false,
    model: "GPT-5 Mini",
    cost: "$0.003",
  },
  {
    text: '"Translate this article"',
    task: "Translation",
    complexity: "Low Context",
    tools: false,
    model: "Gemini Flash",
    cost: "$0.001",
  },
  {
    text: '"Generate SQL Migration"',
    task: "Code Generation",
    complexity: "Medium Context",
    tools: true,
    model: "DeepSeek",
    cost: "$0.004",
  },
];

type Phase = "incoming" | "analyzing" | "routing" | "completed" | "pause";

const phaseDurations: Record<Phase, number> = {
  incoming: 1800,
  analyzing: 2200,
  routing: 1800,
  completed: 1500,
  pause: 500,
};

const phaseOrder: Phase[] = [
  "incoming",
  "analyzing",
  "routing",
  "completed",
  "pause",
];

function CheckIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      className="text-emerald-400"
    >
      <motion.path
        d="M3 8.5L6.5 12L13 4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
      />
    </svg>
  );
}

export default function RoutingSimulation() {
  const reduced = usePrefersReducedMotion();
  const [requestIdx, setRequestIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>("incoming");

  const advancePhase = useCallback(() => {
    setPhase((current) => {
      const idx = phaseOrder.indexOf(current);
      if (idx < phaseOrder.length - 1) return phaseOrder[idx + 1];
      return "incoming";
    });
  }, []);

  useEffect(() => {
    if (reduced) return;

    const timeout = setTimeout(() => {
      if (phase === "pause") {
        setRequestIdx((prev) => (prev + 1) % requests.length);
        setPhase("incoming");
      } else {
        advancePhase();
      }
    }, phaseDurations[phase]);

    return () => clearTimeout(timeout);
  }, [phase, advancePhase, reduced]);

  const req = requests[requestIdx];

  if (reduced) {
    return (
      <div className="mx-auto w-full max-w-2xl rounded-2xl border border-white/[0.06] bg-[#0a0a0a] p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wider text-white/40">
              Routing to
            </p>
            <p className="mt-1 font-semibold text-white">{req.model}</p>
          </div>
          <p className="text-sm text-[#8b8b8b]">{req.cost}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0a0a0a] text-left" style={{ height: "100px", position: "relative" }}>
      <AnimatePresence mode="wait">
        {phase === "incoming" && (
          <motion.div
            key={`incoming-${requestIdx}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.4 }}
            className="absolute inset-0 p-6"
          >
            <p className="text-xs uppercase tracking-wider text-white/40">
              Incoming Request
            </p>
            <p className="mt-2 font-mono text-lg text-white">{req.text}</p>
          </motion.div>
        )}

        {phase === "analyzing" && (
          <motion.div
            key={`analyzing-${requestIdx}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.4 }}
            className="absolute inset-0 p-6"
          >
            <p className="text-xs uppercase tracking-wider text-white/40">
              Analyzing...
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <motion.span
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, delay: 0 }}
                className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-1 text-xs text-[#8b8b8b]"
              >
                ✓ {req.task}
              </motion.span>
              <motion.span
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, delay: 0.08 }}
                className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-1 text-xs text-[#8b8b8b]"
              >
                ✓ {req.complexity}
              </motion.span>
              {req.tools && (
                <motion.span
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3, delay: 0.16 }}
                  className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-1 text-xs text-[#8b8b8b]"
                >
                  ✓ Tool Calls Required
                </motion.span>
              )}
            </div>
          </motion.div>
        )}

        {phase === "routing" && (
          <motion.div
            key={`routing-${requestIdx}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.4 }}
            className="absolute inset-0 flex items-center justify-between p-6"
          >
            <div>
              <p className="text-xs uppercase tracking-wider text-white/40">
                Routing to
              </p>
              <p className="mt-1 font-semibold text-white">{req.model}</p>
            </div>
            <p className="text-sm text-[#8b8b8b]">{req.cost}</p>
          </motion.div>
        )}

        {phase === "completed" && (
          <motion.div
            key={`completed-${requestIdx}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.4 }}
            className="absolute inset-0 flex items-center justify-between p-6"
          >
            <div className="flex items-center gap-2">
              <CheckIcon />
              <span className="text-sm font-medium text-white">Completed</span>
            </div>
            <p className="text-sm text-[#8b8b8b]">{req.cost}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
