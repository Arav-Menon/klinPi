"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  motion,
  useMotionTemplate,
  useScroll,
  useSpring,
  useTransform,
} from "framer-motion";
import { Menu } from "lucide-react";

import { Button } from "@/app/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/app/components/ui/sheet";
import { Logo } from "@/app/components/landing/logo";
import {
  pauseSmoothScroll,
  resumeSmoothScroll,
} from "@/app/components/smooth-scroll";
import { usePrefersReducedMotion } from "@/app/lib/hooks";

const EASE = [0.16, 1, 0.3, 1] as const;

const NAV_LINKS = [
  { label: "Workflow", href: "#workflow" },
  { label: "Repository", href: "#repository" },
  { label: "Sandbox", href: "#sandbox" },
  { label: "Features", href: "#features" },
];

const LINK_CLASS =
  "inline-flex rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground";

/**
 * Scroll morph range: the navbar interpolates continuously from its
 * full-width state at scrollY = 0 to the centered floating state at
 * scrollY >= 80px. A spring smooths the transition in both directions.
 */
const SCROLL_RANGE = 80;
const SPRING = { stiffness: 320, damping: 34, mass: 0.45 } as const;

export default function Navbar() {
  const reduced = usePrefersReducedMotion();
  const [open, setOpen] = useState(false);

  // If the navbar unmounts while the Sheet is open (route change), make
  // sure smooth scrolling is not left paused on the next page.
  useEffect(() => () => resumeSmoothScroll(), []);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) pauseSmoothScroll();
    else resumeSmoothScroll();
  };

  const { scrollY } = useScroll();
  const rawProgress = useTransform(scrollY, [0, SCROLL_RANGE], [0, 1], {
    clamp: true,
  });
  const springProgress = useSpring(rawProgress, SPRING);
  // Reduced motion: follow the scroll position directly, no inertia.
  const progress = reduced ? rawProgress : springProgress;

  // Geometry: content-width (matches .container) → compact floating pill.
  const maxWidth = useTransform(progress, [0, 1], [1280, 840]);
  const gutter = useTransform(progress, [0, 1], [0, 32]);
  const maxWidthStyle = useMotionTemplate`min(${maxWidth}px, calc(100vw - ${gutter}px))`;
  const top = useTransform(progress, [0, 1], [0, 16]);
  const height = useTransform(progress, [0, 1], [56, 48]);
  const borderRadius = useTransform(progress, [0, 1], [0, 12]);
  const padShrink = useTransform(progress, [0, 1], [0, 8]);
  const paddingLeft = useMotionTemplate`calc(var(--nav-pad) - ${padShrink}px)`;

  // Surface: translucent integration → slightly more opaque floating card.
  const backgroundColor = useTransform(
    progress,
    [0, 1],
    ["rgba(255, 255, 255, 0.78)", "rgba(255, 255, 255, 0.93)"],
  );
  const backdropFilter = useTransform(
    progress,
    [0, 1],
    ["blur(8px)", "blur(16px)"],
  );
  const boxShadow = useTransform(
    progress,
    [0, 1],
    [
      "0px 0px 0px 0px rgba(15, 15, 20, 0)",
      "0px 10px 32px -14px rgba(15, 15, 20, 0.18)",
    ],
  );
  // Side/top hairlines only appear as the navbar lifts off the page;
  // the bottom border (from the class) stays visible in both states.
  const edgeColor = useTransform(
    progress,
    [0, 1],
    ["rgba(216, 216, 216, 0)", "rgb(216, 216, 216)"],
  );

  return (
    <motion.header
      initial={reduced ? false : { opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: EASE }}
      style={{
        maxWidth: maxWidthStyle,
        top,
        height,
        borderRadius,
        paddingLeft,
        paddingRight: paddingLeft,
        backgroundColor,
        backdropFilter,
        WebkitBackdropFilter: backdropFilter,
        boxShadow,
        borderTopColor: edgeColor,
        borderLeftColor: edgeColor,
        borderRightColor: edgeColor,
      }}
      className="fixed inset-x-0 z-50 mx-auto w-full border border-border bg-background/85 [--nav-pad:1.5rem] lg:[--nav-pad:2rem]"
    >
      <nav
        aria-label="Main"
        className="flex h-full items-center justify-between gap-4 sm:gap-6"
      >
        <Link
          href="/"
          aria-label="Klinpi home"
          className="rounded-md transition-opacity hover:opacity-70"
        >
          <Logo />
        </Link>

        <ul className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((link) => (
            <li key={link.href}>
              <a href={link.href} className={LINK_CLASS}>
                {link.label}
              </a>
            </li>
          ))}
        </ul>

        <div className="hidden items-center gap-1 md:flex">
          <Button
            variant="ghost"
            size="lg"
            className="px-3.5 text-muted-foreground"
            asChild
          >
            <Link href="/signin">Sign in</Link>
          </Button>
          <Button
            size="lg"
            className="px-4 transition-transform duration-150 hover:-translate-y-px"
            asChild
          >
            <Link href="/signup">Start building</Link>
          </Button>
        </div>

        <div className="md:hidden">
          <Sheet open={open} onOpenChange={handleOpenChange}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Open menu"
                className="text-muted-foreground"
              >
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent
              side="right"
              className="w-72 gap-0 p-0"
              data-lenis-prevent
            >
              <SheetHeader className="border-b border-border px-4 py-3.5">
                <SheetTitle className="flex items-center gap-2">
                  <Logo />
                </SheetTitle>
              </SheetHeader>
              <ul className="flex flex-col gap-0.5 px-3 py-3">
                {NAV_LINKS.map((link) => (
                  <li key={link.href}>
                    <a
                      href={link.href}
                      onClick={() => setOpen(false)}
                      className={`${LINK_CLASS} block`}
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
              <div className="mt-auto flex flex-col gap-2 border-t border-border p-4">
                <Button variant="outline" size="lg" asChild>
                  <Link href="/signin">Sign in</Link>
                </Button>
                <Button size="lg" asChild>
                  <Link href="/signup">Start building</Link>
                </Button>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </nav>
    </motion.header>
  );
}
