import Link from "next/link";

import { Logo } from "@/app/components/landing/logo";

interface AuthLayoutProps {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

/*
 * Shared shell for the Sign in / Sign up pages: Klinpi logo anchored
 * top-left, with the page heading, auth card, and cross-navigation footer
 * centered independently. Light surface — same textured background the
 * landing page gets from the root layout.
 *
 * Entrance uses the `.auth-reveal` CSS animation (globals.css) so the
 * global prefers-reduced-motion kill-switch disables it reliably.
 */
export function AuthLayout({ title, subtitle, children, footer }: AuthLayoutProps) {
  return (
    <main
      id="main"
      className="flex min-h-svh w-full flex-col px-4 py-12 sm:px-6"
    >
      <div className="auth-reveal">
        <Link
          href="/"
          aria-label="Klinpi — back to home"
          className="inline-flex rounded-lg transition-opacity duration-[150ms] hover:opacity-80"
        >
          <Logo />
        </Link>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center">
        <div className="w-full max-w-[26rem]">
          <header className="auth-reveal text-center" style={{ animationDelay: "60ms" }}>
            <h1 className="text-balance text-[2rem] leading-none font-semibold tracking-[-0.03em] text-foreground">
              {title}
            </h1>
            <p className="text-balance mt-3 text-sm leading-relaxed text-muted-foreground">
              {subtitle}
            </p>
          </header>

          <section
            className="auth-reveal mt-8 rounded-xl border border-border bg-card p-6 sm:p-8"
            style={{ animationDelay: "120ms" }}
          >
            {children}
          </section>

          {footer ? (
            <div
              className="auth-reveal mt-6 text-center text-sm text-muted-foreground"
              style={{ animationDelay: "180ms" }}
            >
              {footer}
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}
