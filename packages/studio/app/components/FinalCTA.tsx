"use client";

import { motion } from "framer-motion";

const ease = [0.16, 1, 0.3, 1] as const;

export default function FinalCTA() {
  return (
    <section className="py-24">
      <div className="container">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.6, ease }}
          className="mx-auto max-w-lg text-center"
        >
          <h2 className="mb-4 text-3xl font-bold tracking-tight text-white md:text-4xl">
            Your Code. Your Repository. Your Agent.
          </h2>
          <p className="mb-10 text-base text-[#8b8b8b]">
            Let Klinpi handle the engineering work while you focus on what to
            build.
          </p>

          <div className="flex justify-center gap-4">
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
          </div>
        </motion.div>
      </div>
    </section>
  );
}
