import type { Metadata } from "next";
import type { ReactNode } from "react";

import { ConsoleGuard } from "@/app/components/console/console-guard";

export const metadata: Metadata = {
  title: "Console | Klinpi",
  description: "Your Klinpi workspace — start sessions and work with your coding agent.",
};

/**
 * `/console/[userId]` — the personal workspace route. The param is
 * navigation identity only; ConsoleGuard verifies it against the
 * authenticated user from `GET /api/v1/auth/me` before rendering.
 */
export default async function ConsoleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  return <ConsoleGuard userId={userId}>{children}</ConsoleGuard>;
}
