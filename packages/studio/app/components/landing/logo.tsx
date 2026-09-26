import Image from "next/image";

import { cn } from "cn";

/*
 * The Klinpi mark is a raster asset shipped with the project
 * (public/assets/Klinpi.jpg). It is exported here as transparent
 * PNGs — dark mark for light surfaces, light mark for dark surfaces —
 * so the navbar/footer/product mock-ups all use the real logo.
 */
const MARK = {
  src: "/assets/klinpi-mark.png",
  inverseSrc: "/assets/klinpi-mark-inverse.png",
  width: 94,
  height: 84,
};

export function LogoMark({
  className,
  inverse = false,
}: {
  className?: string;
  inverse?: boolean;
}) {
  return (
    <Image
      src={inverse ? MARK.inverseSrc : MARK.src}
      alt=""
      width={MARK.width}
      height={MARK.height}
      aria-hidden="true"
      className={cn("h-5 w-auto shrink-0", className)}
    />
  );
}

export function Logo({
  className,
  inverse = false,
}: {
  className?: string;
  inverse?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark inverse={inverse} />
      <span className="text-[15px] leading-none font-semibold tracking-[-0.02em] text-foreground">
        klinpi
      </span>
    </span>
  );
}
