"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { usePrefersReducedMotion } from "../lib/hooks";

type Phase = "working" | "running" | "completed" | "pause";

const phaseDurations: Record<Phase, number> = {
  working: 2000,
  running: 2500,
  completed: 1500,
  pause: 500,
};

const phaseOrder: Phase[] = ["working", "running", "completed", "pause"];

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
  const [phase, setPhase] = useState<Phase>("working");

  const advancePhase = useCallback(() => {
    setPhase((current) => {
      const idx = phaseOrder.indexOf(current);
      if (idx < phaseOrder.length - 1) return phaseOrder[idx + 1];
      return "working";
    });
  }, []);

  useEffect(() => {
    if (reduced) return;

    const timeout = setTimeout(() => {
      advancePhase();
    }, phaseDurations[phase]);

    return () => clearTimeout(timeout);
  }, [phase, advancePhase, reduced]);

  if (reduced) {
    return (
      <div className="mx-auto w-full max-w-2xl rounded-2xl border border-white/[0.06] bg-[#0a0a0a] p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wider text-white/40">
              Working on
            </p>
            <p className="mt-1 font-semibold text-white">Your GitHub Repository</p>
          </div>
          <p className="text-sm text-emerald-400">$ Agent is running</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0a0a0a] text-left" style={{ height: "100px", position: "relative" }}>
      <AnimatePresence mode="wait">
        {phase === "working" && (
          <motion.div
            key="working"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.4 }}
            className="absolute inset-0 p-6"
          >
            <p className="text-xs uppercase tracking-wider text-white/40">
              Working on
            </p>
            <p className="mt-2 font-mono text-lg text-white">Your GitHub Repository</p>
          </motion.div>
        )}

        {phase === "running" && (
          <motion.div
            key="running"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.4 }}
            className="absolute inset-0 flex items-center justify-between p-6"
          >
            <div>
              <p className="text-xs uppercase tracking-wider text-white/40">
                Working on
              </p>
              <p className="mt-1 font-semibold text-white">Your GitHub Repository</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
              <p className="text-sm text-emerald-400">$ Agent is running</p>
            </div>
          </motion.div>
        )}

        {phase === "completed" && (
          <motion.div
            key="completed"
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
            <p className="text-sm text-[#8b8b8b]">Changes ready</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
