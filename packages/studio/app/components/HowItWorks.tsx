"use client";

import { useState, useEffect, useRef } from "react";
import { motion, useInView } from "framer-motion";
import { usePrefersReducedMotion } from "../lib/hooks";

const EASE = [0.16, 1, 0.3, 1] as const;

const agents = [
  "OpenCode",
  "Claude Code",
  "Codex",
  "Cursor",
  "Gemini CLI",
  "Qwen Code",
];

const models = [
  { name: "Claude", position: "top-0 left-[15%]" },
  { name: "GPT-5", position: "top-0 right-[15%]" },
  { name: "Gemini", position: "bottom-0 left-[10%]" },
  { name: "DeepSeek", position: "bottom-0 right-[10%]" },
  { name: "Qwen", position: "top-1/2 -translate-y-1/2 right-0" },
];

const cardClass =
  "rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-sm shadow-[0_0_40px_rgba(255,255,255,0.02)] p-5 transition-all duration-300 hover:border-white/[0.1] hover:bg-white/[0.05]";

function ConnectionLine({ vertical }: { vertical?: boolean }) {
  const reduced = usePrefersReducedMotion();

  if (vertical) {
    return (
      <div className="flex justify-center py-2">
        <div className="relative h-10 w-px bg-gradient-to-b from-transparent via-white/10 to-transparent">
          {!reduced && (
            <div
              className="absolute left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-white/60"
              style={{ animation: "glow-dot-vertical 2s linear infinite" }}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="hidden items-center px-1 md:flex">
      <div className="relative h-px w-10 bg-gradient-to-r from-transparent via-white/10 to-transparent">
        {!reduced && (
          <div
            className="absolute top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-white/60"
            style={{ animation: "glow-dot 2s linear infinite" }}
          />
        )}
      </div>
    </div>
  );
}

function TypewriterText({
  text,
  trigger,
  speed = 50,
}: {
  text: string;
  trigger: boolean;
  speed?: number;
}) {
  const reduced = usePrefersReducedMotion();
  const [displayed, setDisplayed] = useState(reduced ? text : "");
  const started = useRef(false);

  useEffect(() => {
    if (reduced || !trigger || started.current) return;
    started.current = true;
    let count = 0;
    const interval = setInterval(() => {
      count++;
      setDisplayed(text.slice(0, count));
      if (count >= text.length) clearInterval(interval);
    }, speed);
    return () => clearInterval(interval);
  }, [trigger, text, speed, reduced]);

  return (
    <span>
      {displayed}
      {trigger && displayed.length < text.length && (
        <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-white/60" />
      )}
    </span>
  );
}

function Step1() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <div ref={ref} className={`${cardClass} w-full md:w-0 md:flex-1 md:min-w-0`}>
      <p className="mb-1 text-xs uppercase tracking-wider text-white/40">Step 1</p>
      <h3 className="mb-1.5 text-sm font-semibold text-white">Paste your API Key</h3>
      <p className="mb-4 text-xs text-[#8b8b8b]">Configure Klinpi once.</p>
      <div className="rounded-lg bg-[#0a0a0a] p-3 font-mono text-xs leading-relaxed">
        <span className="text-[#c084fc]">KLINPI_API_KEY</span>
        <span className="text-white/40">=</span>
        <span className="text-emerald-400">
          <TypewriterText text="kp_xxx" trigger={inView} speed={50} />
        </span>
      </div>
    </div>
  );
}

function Step2() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <div ref={ref} className={`${cardClass} w-full md:w-0 md:flex-1 md:min-w-0`}>
      <p className="mb-1 text-xs uppercase tracking-wider text-white/40">Step 2</p>
      <h3 className="mb-3 text-sm font-semibold text-white">Use Your Favorite terminal Agent</h3>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {agents.map((agent) => (
          <span
            key={agent}
            className="rounded-md border border-white/[0.06] bg-white/[0.03] px-2.5 py-1 text-xs text-[#8b8b8b] transition-all duration-200 hover:scale-105 hover:border-white/[0.12] hover:text-white hover:shadow-[0_0_12px_rgba(255,255,255,0.06)]"
          >
            {agent}
          </span>
        ))}
      </div>
      <div className="rounded-lg bg-[#0a0a0a] p-3 font-mono text-xs">
        <span className="text-white/40">&gt;&nbsp;</span>
        <span className="text-white">
          <TypewriterText text="Fix auth.ts line 38" trigger={inView} speed={40} />
        </span>
      </div>
    </div>
  );
}

function Step3() {
  const reduced = usePrefersReducedMotion();
  const [activeIdx, setActiveIdx] = useState(0);

  useEffect(() => {
    if (reduced) return;
    const interval = setInterval(() => {
      setActiveIdx((prev) => (prev + 1) % models.length);
    }, 3000);
    return () => clearInterval(interval);
  }, [reduced]);

  const floatVariants = [
    { y: [0, -6, 0], duration: 3.2 },
    { y: [0, -5, 0], duration: 3.8 },
    { y: [0, -7, 0], duration: 3.5 },
    { y: [0, -4, 0], duration: 4.0 },
    { y: [0, -6, 0], duration: 3.6 },
  ];

  return (
    <div className={`${cardClass} w-full md:w-0 md:flex-1 md:min-w-0`}>
      <p className="mb-1 text-xs uppercase tracking-wider text-white/40">Step 3</p>
      <h3 className="mb-3 text-sm font-semibold text-white">Klinpi Routes Everything</h3>
      <div className="relative mx-auto flex h-44 items-center justify-center">
        <div className="relative z-10 rounded-lg border border-white/[0.1] bg-white/[0.06] px-4 py-2 text-xs font-semibold text-white shadow-[0_0_30px_rgba(255,255,255,0.04)]">
          KLINPI
        </div>
        {models.map((model, i) => (
          <motion.div
            key={model.name}
            className={`absolute ${model.position} rounded-md border px-2.5 py-1 text-xs font-medium transition-all duration-500 ${
              i === activeIdx
                ? "border-white/20 bg-white/[0.08] text-white shadow-[0_0_16px_rgba(255,255,255,0.08)]"
                : "border-white/[0.04] bg-white/[0.02] text-white/40"
            }`}
            animate={reduced ? {} : { y: floatVariants[i].y }}
            transition={
              reduced
                ? {}
                : {
                    duration: floatVariants[i].duration,
                    repeat: Infinity,
                    ease: "easeInOut",
                    delay: i * 0.2,
                  }
            }
          >
            {model.name}
          </motion.div>
        ))}
        {!reduced && (
          <motion.div
            className="absolute h-px bg-gradient-to-r from-white/20 to-transparent"
            style={{ width: "40px", transformOrigin: "center" }}
            animate={{ rotate: activeIdx * 72 - 90, opacity: [0.3, 0.8, 0.3] }}
            transition={{
              rotate: { duration: 0.5, ease: EASE },
              opacity: { duration: 2, repeat: Infinity, ease: "easeInOut" },
            }}
          />
        )}
      </div>
    </div>
  );
}

function Step4() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const reduced = usePrefersReducedMotion();

  const lines = [
    { text: "✔ Fixed auth.ts", color: "text-emerald-400", delay: 0 },
    { text: "Model: Claude Sonnet", color: "text-white", delay: 200 },
    { text: "Latency: 1.2s", color: "text-[#8b8b8b]", delay: 400 },
    { text: "Cost: $0.18", color: "text-[#8b8b8b]", delay: 600 },
  ];

  return (
    <div ref={ref} className={`${cardClass} w-full md:w-0 md:flex-1 md:min-w-0`}>
      <p className="mb-1 text-xs uppercase tracking-wider text-white/40">Step 4</p>
      <h3 className="mb-1.5 text-sm font-semibold text-white">Receive the Response</h3>
      <p className="mb-4 text-xs text-[#8b8b8b]">Instantly.</p>
      <div className="rounded-lg bg-[#0a0a0a] p-3 font-mono text-xs space-y-1">
        {lines.map((line) => (
          <motion.div
            key={line.text}
            initial={reduced ? { opacity: 1 } : { opacity: 0, x: -4 }}
            animate={inView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.4, delay: reduced ? 0 : line.delay / 1000, ease: EASE }}
            className={line.color}
          >
            {line.text}
          </motion.div>
        ))}
      </div>
    </div>
  );
}

export default function HowItWorks() {
  const reduced = usePrefersReducedMotion();

  return (
    <section className="py-24">
      <div className="container">
        {/* Header */}
        <motion.div
          initial={reduced ? { opacity: 1 } : { opacity: 0, y: 16 }}
          whileInView={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.6, ease: EASE }}
          className="mx-auto mb-16 max-w-xl text-center"
        >
          <h2 className="mb-4 text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Keep Coding.
            <br />
            Klinpi Handles the Rest.
          </h2>
          <p className="mx-auto max-w-md text-base text-[#8b8b8b]">
            Your workflow doesn&apos;t change. Paste one API key and Klinpi
            intelligently routes every request to the best model.
          </p>
        </motion.div>

        {/* Desktop: horizontal timeline */}
        <div className="hidden md:block">
          <motion.div
            initial={reduced ? { opacity: 1 } : { opacity: 0, y: 20 }}
            whileInView={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-50px" }}
            transition={{ duration: 0.6, delay: 0.1, ease: EASE }}
            className="mx-auto flex max-w-5xl items-center"
          >
            <Step1 />
            <ConnectionLine />
            <Step2 />
            <ConnectionLine />
            <Step3 />
            <ConnectionLine />
            <Step4 />
          </motion.div>
        </div>

        {/* Mobile: vertical stack */}
        <div className="md:hidden">
          <motion.div
            initial={reduced ? { opacity: 1 } : { opacity: 0, y: 20 }}
            whileInView={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-50px" }}
            transition={{ duration: 0.6, delay: 0.1, ease: EASE }}
            className="mx-auto flex max-w-sm flex-col"
          >
            <Step1 />
            <ConnectionLine vertical />
            <Step2 />
            <ConnectionLine vertical />
            <Step3 />
            <ConnectionLine vertical />
            <Step4 />
          </motion.div>
        </div>

        {/* Caption */}
        <motion.p
          initial={reduced ? { opacity: 1 } : { opacity: 0 }}
          whileInView={reduced ? { opacity: 1 } : { opacity: 1 }}
          viewport={{ once: true, margin: "-50px" }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="mt-16 text-center text-sm text-[#8b8b8b]"
        >
          One API. Every model. Zero manual routing.
        </motion.p>
      </div>
    </section>
  );
}
