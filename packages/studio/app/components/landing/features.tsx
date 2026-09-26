"use client";

import { motion } from "framer-motion";
import {
  Container,
  Database,
  FileDiff,
  Radio,
  Server,
} from "lucide-react";

import { GitHubIcon } from "@/app/components/landing/icons";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/app/components/ui/card";
import { usePrefersReducedMotion } from "@/app/lib/hooks";

const EASE = [0.16, 1, 0.3, 1] as const;

const FEATURES = [
  {
    icon: GitHubIcon,
    title: "GitHub-native",
    body: "Sign in with GitHub and pick from your own repositories — no copying code into a chat window.",
    meta: "oauth · /user/repos",
  },
  {
    icon: Container,
    title: "Isolated sandboxes",
    body: "Every session gets a fresh cloud environment with the repository cloned at /workspace.",
    meta: "one sandbox per session",
  },
  {
    icon: FileDiff,
    title: "Real file edits",
    body: "The agent writes to the working tree, so you review an actual changed file instead of a snippet.",
    meta: "read_file · edit_file",
  },
  {
    icon: Radio,
    title: "Streamed activity",
    body: "Tool calls, results and the agent's messages arrive live as the run progresses.",
    meta: "agent events · websocket",
  },
  {
    icon: Database,
    title: "Session memory",
    body: "Repository knowledge and preferences are stored and retrieved on later runs.",
    meta: "save_memory",
  },
  {
    icon: Server,
    title: "Self-hostable",
    body: "Open source and written in TypeScript — run the stack on your own infrastructure.",
    meta: "docker compose · pnpm",
  },
];

export default function Features() {
  const reduced = usePrefersReducedMotion();

  return (
    <section id="features" className="scroll-mt-24 py-20 md:py-28">
      <div className="container">
        <motion.div
          initial={reduced ? { opacity: 1 } : { opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.6, ease: EASE }}
          className="mx-auto mb-14 max-w-2xl text-center"
        >
          <p className="font-mono text-[11px] tracking-widest text-subtle uppercase">
            Features
          </p>
          <h2 className="text-balance mt-4 text-3xl font-semibold tracking-[-0.03em] text-foreground md:text-4xl">
            Built like a developer tool.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-muted-foreground">
            No orchestration layer, no dashboard to learn — a repository, a
            task, an environment, and a stream you can read.
          </p>
        </motion.div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature, index) => (
            <motion.div
              key={feature.title}
              initial={
                reduced ? { opacity: 1, y: 0 } : { opacity: 0, y: 16 }
              }
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{
                duration: 0.55,
                delay: (index % 3) * 0.07,
                ease: EASE,
              }}
            >
              <Card className="group h-full transition-all duration-200 hover:-translate-y-0.5 hover:border-foreground/25">
                <span className="mx-(--card-spacing) flex size-9 items-center justify-center rounded-lg border border-border bg-muted text-foreground/80 transition-colors group-hover:text-foreground">
                  <feature.icon className="size-4" aria-hidden="true" />
                </span>
                <CardHeader>
                  <CardTitle className="text-[15px] font-medium text-foreground">
                    {feature.title}
                  </CardTitle>
                  <CardDescription className="leading-relaxed">
                    {feature.body}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="border-t border-border/70 pt-3 font-mono text-[11px] text-subtle">
                    {feature.meta}
                  </p>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
