"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (callback) => {
      const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
      mql.addEventListener("change", callback);
      return () => mql.removeEventListener("change", callback);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

interface SequenceOptions {
  /** Start (or restart) stepping through the sequence. */
  enabled: boolean;
  /** Change this value to reset the sequence from the beginning. */
  runKey?: number;
}

/**
 * Reveals items one at a time using each item's own `delayMs`.
 * Returns the number of items that should be visible.
 *
 * With reduced motion enabled every item is revealed immediately, so the
 * component always renders its complete, readable state.
 */
export function useSequence<T extends { delayMs?: number }>(
  items: readonly T[],
  { enabled, runKey = 0 }: SequenceOptions,
): number {
  const reduced = usePrefersReducedMotion();
  const [state, setState] = useState({ key: runKey, count: 0 });
  const count = state.key === runKey ? state.count : 0;

  useEffect(() => {
    if (reduced || !enabled || count >= items.length) return;

    const id = window.setTimeout(() => {
      setState((prev) => ({
        key: runKey,
        count: prev.key === runKey ? prev.count + 1 : 1,
      }));
    }, items[count]?.delayMs ?? 500);

    return () => window.clearTimeout(id);
  }, [enabled, count, runKey, reduced, items]);

  return reduced ? items.length : count;
}

/** True once the element has entered the viewport. */
export function useScrollY(): number {
  const [scrollY, setScrollY] = useState(0);

  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setScrollY(window.scrollY));
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return scrollY;
}

/** Runs `handler` on interval, but only while `active` is true. */
export function useInterval(handler: () => void, delay: number, active: boolean) {
  const saved = useRef(handler);

  useEffect(() => {
    saved.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => saved.current(), delay);
    return () => window.clearInterval(id);
  }, [delay, active]);
}
