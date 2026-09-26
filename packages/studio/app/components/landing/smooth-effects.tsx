"use client";

import { useEffect } from "react";

/**
 * Scroll-linked GSAP/ScrollTrigger effects for the landing page.
 * Complements (never duplicates) the Motion-based entrance animations:
 * section reveals stay in Motion, while ScrollTrigger owns parallax
 * and scrubbed scroll relationships.
 *
 * All effects are skipped under prefers-reduced-motion so the page
 * stays visually identical to its static design.
 */
export default function SmoothEffects() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let disposed = false;
    let ctx: { revert(): void } | undefined;

    (async () => {
      const [{ default: gsap }, { default: ScrollTrigger }] = await Promise.all([
        import("gsap"),
        import("gsap/ScrollTrigger"),
      ]);
      if (disposed) return;

      gsap.registerPlugin(ScrollTrigger);

      ctx = gsap.context(
        () => {
          // Hero/CTA glow clouds drift upward as their section scrolls by.
          gsap.utils.toArray<HTMLElement>(".bg-glow-hero").forEach((glow) => {
            gsap.fromTo(
              glow,
              { y: 0 },
              {
                y: -70,
                ease: "none",
                scrollTrigger: {
                  trigger: glow,
                  start: "top top",
                  end: "bottom top",
                  scrub: true,
                },
              },
            );
          });

          // Hero product demo eases upward slightly as it exits the viewport.
          const demo = document.querySelector<HTMLElement>(
            '[data-parallax="demo"]',
          );
          if (demo) {
            gsap.fromTo(
              demo,
              { y: 0 },
              {
                y: -40,
                ease: "none",
                scrollTrigger: {
                  trigger: demo,
                  start: "top 30%",
                  end: "bottom top",
                  scrub: true,
                },
              },
            );
          }

          // Fixed background grid drifts with page progress (no layout gap,
          // because the layer never moves — only its background does).
          const grid = document.querySelector<HTMLElement>(".bg-grid");
          if (grid) {
            gsap.fromTo(
              grid,
              { backgroundPosition: "0px 0px" },
              {
                backgroundPosition: "0px -160px",
                ease: "none",
                scrollTrigger: { start: 0, end: "max", scrub: true },
              },
            );
          }

          // Decorative connector hairlines draw themselves in on first
          // entry — these are the only static elements on the page, so no
          // Motion reveal is duplicated here.
          gsap.utils.toArray<HTMLElement>("[data-scroll-line]").forEach((line) => {
            const vertical = line.dataset.scrollLine === "v";
            gsap.fromTo(
              line,
              {
                scaleX: vertical ? 1 : 0,
                scaleY: vertical ? 0 : 1,
                transformOrigin: "center center",
              },
              {
                scaleX: 1,
                scaleY: 1,
                duration: 0.7,
                ease: "power2.out",
                scrollTrigger: {
                  trigger: line,
                  start: "top 88%",
                  once: true,
                },
              },
            );
          });
        },
        document.getElementById("main") ?? undefined,
      );
    })();

    return () => {
      disposed = true;
      ctx?.revert();
    };
  }, []);

  return null;
}
