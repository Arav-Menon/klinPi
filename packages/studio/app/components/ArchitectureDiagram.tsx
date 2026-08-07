"use client";

import { motion } from "framer-motion";

const providers = ["Claude", "GPT-5", "Gemini", "DeepSeek", "Qwen"];
const clients = ["OpenCode", "Claude Code", "Codex", "Cursor", "Devin"];

export default function ArchitectureDiagram() {
  return (
    <div className="mx-auto max-w-[900px]">
      <div className="flex flex-col items-center gap-4">
        {/* Providers */}
        <div className="flex flex-wrap justify-center gap-3">
          {providers.map((name, i) => (
            <motion.div
              key={name}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.8 + i * 0.08 }}
              className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-8 py-3.5 text-sm font-medium text-[#8b8b8b]"
            >
              {name}
            </motion.div>
          ))}
        </div>

        {/* Arrow */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 1.3 }}
          className="flex flex-col items-center py-3"
        >
          <div className="h-8 w-px bg-white/10" />
          <svg
            width="8"
            height="6"
            viewBox="0 0 8 6"
            fill="none"
            className="text-white/20"
          >
            <path d="M4 6L0.5 0.75H7.5L4 6Z" fill="currentColor" />
          </svg>
        </motion.div>

        {/* Klinpi */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, delay: 1.4 }}
          className="rounded-2xl border border-white/[0.08] bg-white/[0.05] px-12 py-5 text-base font-semibold tracking-wide text-white"
        >
          KLINPI
        </motion.div>

        {/* Arrow */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 1.6 }}
          className="flex flex-col items-center py-3"
        >
          <div className="h-8 w-px bg-white/10" />
          <svg
            width="8"
            height="6"
            viewBox="0 0 8 6"
            fill="none"
            className="text-white/20"
          >
            <path d="M4 6L0.5 0.75H7.5L4 6Z" fill="currentColor" />
          </svg>
        </motion.div>

        {/* Clients */}
        <div className="flex flex-wrap justify-center gap-3">
          {clients.map((name, i) => (
            <motion.div
              key={name}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 1.7 + i * 0.08 }}
              className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-8 py-3.5 text-sm font-medium text-[#8b8b8b]"
            >
              {name}
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}
