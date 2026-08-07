"use client";

import { motion } from "framer-motion";
import { Route, Layers, Plug, BadgeDollarSign } from "lucide-react";
import Hero from "./components/Hero";
import FeatureCard from "./components/FeatureCard";
import SystemArchitecture from "./components/SystemArchitecture";
import CodeExample from "./components/CodeExample";
import Footer from "./components/Footer";

const features = [
  {
    icon: Route,
    title: "Smart Routing",
    description:
      "Automatically picks the best model for every request.",
  },
  {
    icon: Layers,
    title: "Context Aware",
    description:
      "Understands sessions instead of blindly forwarding prompts.",
  },
  {
    icon: Plug,
    title: "Provider Agnostic",
    description:
      "Bring your own providers through one API.",
  },
  {
    icon: BadgeDollarSign,
    title: "Cost Optimization",
    description:
      "Spend less without sacrificing output quality.",
  },
];

export default function Home() {
  return (
    <>
      <Hero />

      {/* Features */}
      <section className="pb-32">
        <div className="container">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.6 }}
            className="mx-auto max-w-[600px] text-center"
          >
            <h2 className="mb-4 text-3xl font-bold tracking-tight text-white md:text-4xl">
              Built for AI Engineering Teams
            </h2>
            <p className="mb-16 text-base text-[#8b8b8b]">
              The infrastructure layer between your agents and every model.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.6, delay: 0.15 }}
            className="mx-auto grid max-w-[1000px] grid-cols-1 gap-5 sm:grid-cols-2"
          >
            {features.map((feature) => (
              <FeatureCard
                key={feature.title}
                icon={feature.icon}
                title={feature.title}
                description={feature.description}
              />
            ))}
          </motion.div>
        </div>
      </section>

      {/* Architecture */}
      <section className="pb-32">
        <div className="container">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.6 }}
            className="mx-auto max-w-[600px] text-center"
          >
            <h2 className="mb-4 text-3xl font-bold tracking-tight text-white md:text-4xl">
              How It Works
            </h2>
            <p className="mb-4 text-base text-[#8b8b8b]">
              Every request flows through a pipeline of analysis, policy
              evaluation, and intelligent routing.
            </p>
          </motion.div>

          <SystemArchitecture />
        </div>
      </section>

      {/* Code Example */}
      <section className="pb-32">
        <div className="container">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.6 }}
            className="mx-auto max-w-[600px] text-center"
          >
            <h2 className="mb-4 text-3xl font-bold tracking-tight text-white md:text-4xl">
              Simple to Use
            </h2>
            <p className="mb-4 text-base text-[#8b8b8b]">
              A few lines of code. No provider management. No model
              selection headaches.
            </p>
          </motion.div>

          <CodeExample />
        </div>
      </section>

      <Footer />
    </>
  );
}
