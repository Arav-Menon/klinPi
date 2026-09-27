import { SessionWorkspace } from "@/app/components/console/session-workspace";

/**
 * Session detail: persisted history + live agent events + composer.
 * Guarded by SessionGuard in the layout.
 */
export default function SessionPage() {
  return <SessionWorkspace />;
}
