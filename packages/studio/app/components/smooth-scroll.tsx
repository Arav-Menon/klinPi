"use client";

import { useEffect, type ReactNode } from "react";
import type Lenis from "lenis";

let activeLenis: Lenis | null = null;
let paused = false;

/**
 * Lock page scrolling while an overlay (mobile Sheet) is open.
 * Safe to call before Lenis has initialized — the paused flag is
 * honoured when the instance is later created.
 */
export function pauseSmoothScroll() {
  paused = true;
  activeLenis?.stop();
}

export function resumeSmoothScroll() {
  paused = false;
  activeLenis?.start();
}

/**
 * Site-wide smooth scrolling: Lenis drives the window scroll, GSAP's
 * ticker runs the Lenis raf loop, and ScrollTrigger is kept in sync via
 * the official integration (lenis.on("scroll", ScrollTrigger.update),
 * ticker.add(lenis.raf), lagSmoothing(0)).
 *
 * - SSR-safe: everything is imported dynamically inside the effect.
 * - Strict-mode-safe: a disposed flag skips work that finishes after
 *   cleanup, and teardown removes every listener/ticker hook it added.
 * - Reduced-motion-safe: Lenis is never created when the user prefers
 *   reduced motion (native instant scroll), and it is torn down /
 *   re-created if the preference changes at runtime.
 */
export default function SmoothScroll({ children }: { children: ReactNode }) {
  useEffect(() => {
    let disposed = false;
    let teardown: (() => void) | undefined;

    const setup = async () => {
      if (disposed || teardown) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

      const [
        { default: gsap },
        { default: ScrollTrigger },
        { default: LenisCtor },
      ] = await Promise.all([
        import("gsap"),
        import("gsap/ScrollTrigger"),
        import("lenis"),
      ]);
      if (disposed) return;

      gsap.registerPlugin(ScrollTrigger);

      const lenis = new LenisCtor({
        smoothWheel: true,
        syncTouch: false,
        autoRaf: false,
      });

      const onScroll = () => ScrollTrigger.update();
      lenis.on("scroll", onScroll);

      const tick = (time: number) => lenis.raf(time * 1000);
      gsap.ticker.add(tick);
      gsap.ticker.lagSmoothing(0);

      const onAnchorClick = (event: MouseEvent) => {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }
        const link =
          event.target instanceof Element
            ? event.target.closest<HTMLAnchorElement>('a[href^="#"]')
            : null;
        // The skip link keeps native behavior so focus moves correctly.
        if (!link || link.classList.contains("skip-link")) return;
        const hash = link.getAttribute("href");
        if (!hash || hash === "#") return;
        const target = document.getElementById(decodeURIComponent(hash.slice(1)));
        if (!target) return;
        event.preventDefault();
        history.pushState(null, "", hash);
        // Lenis subtracts the target's own scroll-margin-top (our
        // `scroll-mt-24` on the sections), so no manual offset is needed.
        lenis.scrollTo(target);
      };
      document.addEventListener("click", onAnchorClick);

      activeLenis = lenis;
      if (paused) lenis.stop();

      teardown = () => {
        document.removeEventListener("click", onAnchorClick);
        gsap.ticker.remove(tick);
        lenis.off("scroll", onScroll);
        lenis.destroy();
        if (activeLenis === lenis) activeLenis = null;
      };
    };

    const stop = () => {
      teardown?.();
      teardown = undefined;
    };

    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMediaChange = () => {
      stop();
      if (!media.matches) void setup();
    };
    media.addEventListener("change", onMediaChange);

    void setup();

    return () => {
      disposed = true;
      media.removeEventListener("change", onMediaChange);
      stop();
    };
  }, []);

  return <>{children}</>;
}
