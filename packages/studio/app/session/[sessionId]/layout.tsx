import type { Metadata } from "next";
import type { ReactNode } from "react";

import { SessionGuard } from "@/app/components/console/session-guard";

export const metadata: Metadata = {
  title: "Session | Klinpi",
  description: "A coding-agent session — chat with Klinpi and watch it work.",
};

/**
 * `/session/[sessionId]` — session detail route. The param is the
 * backend session id; SessionGuard verifies ownership against the
 * authenticated user (foreign/unknown ids redirect to the console).
 */
export default async function SessionLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <SessionGuard sessionId={sessionId}>{children}</SessionGuard>;
}
