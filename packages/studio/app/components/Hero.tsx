"use client";

import { motion } from "framer-motion";
import ArchitectureDiagram from "./ArchitectureDiagram";

export default function Hero() {
  return (
    <section className="relative flex min-h-screen items-center justify-center overflow-hidden">
      {/* Glow behind heading */}
      <div className="pointer-events-none absolute inset-0 -z-10 bg-glow-hero" />

      {/* Outer container — max-width 1280px */}
      <div className="w-full max-w-[1280px] px-6 lg:px-8">
        {/* Content column — max-width 920px, perfectly centered */}
        <div className="mx-auto flex max-w-[920px] flex-col items-center text-center">
          {/* Logo — 32px down to badge */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8 }}
            className="mb-8 text-xl font-semibold tracking-tight text-white"
          >
            klinpi
          </motion.div>

          {/* Coming Soon badge — 32px down to heading */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.15 }}
            className="mb-8 flex items-center gap-2 rounded-full border border-white/[0.06] bg-white/[0.03] px-4 py-1.5"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-white/60" />
            <span className="text-xs font-medium uppercase tracking-widest text-[#8b8b8b]">
              Coming Soon
            </span>
          </motion.div>

          {/* Heading — 28px down to description */}
          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.3 }}
            className="mb-7 max-w-[850px] text-5xl font-black tracking-tight text-white sm:text-6xl md:text-[5.5rem] md:leading-[0.9]"
          >
            The Intelligent Routing Layer
            <br className="hidden md:block" /> for AI Engineering Teams.
          </motion.h1>

          {/* Description — 40px down to buttons */}
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.5 }}
            className="mb-10 max-w-[620px] text-lg leading-relaxed text-[#8b8b8b]"
          >
            Klinpi intelligently routes every LLM request to the right model,
            balancing quality, speed and cost automatically.
          </motion.p>

          {/* CTA Buttons — 64px down to architecture */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.65 }}
            className="mb-16 flex flex-col items-center gap-4 sm:flex-row"
          >
            <a
              href="#"
              className="rounded-full border border-white/10 bg-white px-8 py-3.5 text-sm font-medium text-black transition-colors duration-200 hover:bg-white/90"
            >
              Join Waitlist
            </a>
            <a
              href="https://github.com/Arav-Menon/klinPi"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-white/[0.06] bg-transparent px-8 py-3.5 text-sm font-medium text-[#8b8b8b] transition-colors duration-200 hover:border-white/10 hover:text-white"
            >
              GitHub
            </a>
          </motion.div>

          {/* Architecture Diagram — visual anchor of the page */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.8 }}
            className="w-full max-w-[900px]"
          >
            <ArchitectureDiagram />
          </motion.div>
        </div>
      </div>
    </section>
  );
}
