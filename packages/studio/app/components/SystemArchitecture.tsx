"use client";

import { motion } from "framer-motion";

const steps = [
  "Terminal Agent",
  "Klinpi",
  "Policy Engine",
  "Task Analyzer",
  "Routing Strategy",
  "Provider Router",
  "LLM",
];

export default function SystemArchitecture() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-100px" }}
      transition={{ duration: 0.7 }}
      className="mx-auto mt-16 w-full max-w-[960px]"
    >
      <div className="rounded-2xl border border-white/[0.06] bg-[#0a0a0a] p-12 md:p-16">
        <div className="flex flex-col items-center gap-0">
          {steps.map((step, i) => (
            <div key={step} className="flex flex-col items-center">
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-10 py-4 text-sm font-medium text-[#8b8b8b] transition-colors duration-300 hover:border-white/[0.1] hover:text-white md:px-14 md:py-5 md:text-base">
                {step}
              </div>
              {i < steps.length - 1 && (
                <div className="flex flex-col items-center py-3">
                  <div className="h-6 w-px bg-white/10" />
                  <svg
                    width="8"
                    height="6"
                    viewBox="0 0 8 6"
                    fill="none"
                    className="text-white/15"
                  >
                    <path d="M4 6L0.5 0.75H7.5L4 6Z" fill="currentColor" />
                  </svg>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
