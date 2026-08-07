"use client";

import { motion } from "framer-motion";
import RoutingSimulation from "./RoutingSimulation";

const EASE = [0.16, 1, 0.3, 1] as const;

export default function Hero() {
  return (
    <section className="relative flex min-h-screen flex-col items-center justify-center px-6">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-glow-hero" />

      <div className="w-full max-w-3xl text-center">

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8 }}
          className="text-xl font-semibold tracking-tight text-white"
        >
          <img src="./favicon.ico" alt="logo" className="mx-auto h-20 w-20" />
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.06 }}
          className="mx-auto inline-flex items-center gap-2 rounded-full border border-white/[0.06] bg-white/[0.03] px-4 py-1.5"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-white/60" />
          <span className="text-xs font-medium uppercase tracking-widest text-[#8b8b8b]">
            Coming Soon
          </span>
        </motion.div>

        <div className="h-10" />

        <motion.h1
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.14, ease: EASE }}
          className="mx-auto max-w-2xl text-4xl font-black tracking-tight text-white sm:text-5xl md:text-6xl md:leading-[0.9]"
        >
          The Intelligent Routing Layer for AI Engineering Teams.
        </motion.h1>

        <div className="h-6" />

        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2, ease: EASE }}
          className="mx-auto max-w-lg text-base leading-relaxed text-[#8b8b8b]"
        >
          Automatically routes every AI request to the best model based on task
          complexity, context and cost.
        </motion.p>

        <div className="h-10" />

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.26, ease: EASE }}
          className="flex justify-center gap-4"
        >
          <a
            href="#"
            className="rounded-full bg-white px-8 py-3 text-sm font-medium text-black transition-colors hover:bg-white/90"
          >
            Join Waitlist
          </a>
          <a
            href="https://github.com/Arav-Menon/klinPi"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full border border-white/10 bg-transparent px-8 py-3 text-sm font-medium text-[#8b8b8b] transition-colors hover:border-white/20 hover:text-white"
          >
            GitHub
          </a>
        </motion.div>

        <div className="h-16" />

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.3, ease: EASE }}
        >
          <RoutingSimulation />
        </motion.div>
      </div>
    </section>
  );
}
