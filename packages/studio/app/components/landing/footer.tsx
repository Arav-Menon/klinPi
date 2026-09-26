"use client";

import Link from "next/link";
import { motion } from "framer-motion";

import { Logo } from "@/app/components/landing/logo";
import { GitHubIcon } from "@/app/components/landing/icons";
import { Separator } from "@/app/components/ui/separator";
import { usePrefersReducedMotion } from "@/app/lib/hooks";

const EASE = [0.16, 1, 0.3, 1] as const;

const COLUMNS: { title: string; links: { label: string; href: string }[] }[] =
  [
    {
      title: "Product",
      links: [
        { label: "Workflow", href: "#workflow" },
        { label: "Sandbox", href: "#sandbox" },
        { label: "Live activity", href: "#activity" },
        { label: "Features", href: "#features" },
      ],
    },
    {
      title: "Get started",
      links: [
        { label: "Start building", href: "/signup" },
        { label: "Sign in", href: "/signin" },
      ],
    },
    {
      title: "Project",
      links: [
        {
          label: "Source code",
          href: "https://github.com/Arav-Menon/klinPi",
        },
        {
          label: "Issue tracker",
          href: "https://github.com/Arav-Menon/klinPi/issues",
        },
      ],
    },
  ];

export default function Footer() {
  const reduced = usePrefersReducedMotion();

  return (
    <motion.footer
      initial={reduced ? { opacity: 1 } : { opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.6, ease: EASE }}
      className="border-t border-border"
    >
      <div className="container py-14">
        <div className="grid gap-10 md:grid-cols-[1.5fr_repeat(3,1fr)]">
          <div className="max-w-xs">
            <Logo />
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              A cloud coding agent that works on your repositories in an
              isolated sandbox.
            </p>
            <a
              href="https://github.com/Arav-Menon/klinPi"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-5 inline-flex items-center gap-2 rounded-md py-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <GitHubIcon />
              Arav-Menon/klinPi
            </a>
          </div>

          {COLUMNS.map((column) => (
            <nav key={column.title} aria-label={column.title}>
              <h2 className="font-mono text-[11px] tracking-widest text-subtle uppercase">
                {column.title}
              </h2>
              <ul className="mt-3 space-y-0.5">
                {column.links.map((link) => (
                  <li key={link.label}>
                    {link.href.startsWith("http") ? (
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-block py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {link.label}
                      </a>
                    ) : (
                      <Link
                        href={link.href}
                        className="inline-block py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <Separator className="mt-12 bg-border" />

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-mono text-[11px] text-subtle">
            © {new Date().getFullYear()} Klinpi · MIT licensed
          </p>
          <p className="flex items-center gap-2 font-mono text-[11px] text-subtle">
            <span className="size-1.5 rounded-full bg-warning" />
            in active development
          </p>
        </div>
      </div>
    </motion.footer>
  );
}
