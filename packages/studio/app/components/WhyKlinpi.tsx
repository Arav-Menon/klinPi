"use client";

import { motion } from "framer-motion";
import { Brain, Zap, Plug, Puzzle } from "lucide-react";

const reasons = [
  {
    icon: Brain,
    title: "Intelligent Routing",
    description:
      "Every request reaches the right model automatically.",
  },
  {
    icon: Zap,
    title: "Cost Efficient",
    description:
      "Spend less without manually choosing models.",
  },
  {
    icon: Plug,
    title: "Provider Agnostic",
    description:
      "Bring your own providers through one API.",
  },
  {
    icon: Puzzle,
    title: "Context Aware",
    description:
      "Routing decisions consider conversations, not isolated prompts.",
  },
];

const ease = [0.16, 1, 0.3, 1] as const;

export default function WhyKlinpi() {
  return (
    <section className="py-24">
      <div className="container">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.6, ease }}
          className="mx-auto mb-16 max-w-lg text-center"
        >
          <h2 className="mb-4 text-3xl font-bold tracking-tight text-white md:text-4xl">
            Why Klinpi?
          </h2>
          <p className="text-base text-[#8b8b8b]">
            The routing layer AI engineering teams have been waiting for.
          </p>
        </motion.div>

        <div className="mx-auto grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2">
          {reasons.map((item, i) => (
            <motion.div
              key={item.title}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-50px" }}
              transition={{ duration: 0.6, delay: i * 0.1, ease }}
              className="rounded-2xl border border-white/[0.06] bg-[#0a0a0a] p-6"
            >
              <item.icon
                size={20}
                strokeWidth={1.5}
                className="mb-4 text-[#8b8b8b]"
              />
              <h3 className="mb-2 text-sm font-semibold text-white">
                {item.title}
              </h3>
              <p className="text-sm leading-relaxed text-[#8b8b8b]">
                {item.description}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
