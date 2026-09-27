import { ConsoleWorkspace } from "@/app/components/console/console-workspace";

/**
 * The new-session workspace. Session-detail addressing is layered on
 * separately; this route is the working surface for starting and
 * holding a coding-agent session.
 */
export default function ConsolePage() {
  return <ConsoleWorkspace />;
}
