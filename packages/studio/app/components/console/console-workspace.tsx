"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { AgentWorkspace } from "@/app/components/console/agent-workspace";
import { Composer } from "@/app/components/console/composer";
import { SessionHeader } from "@/app/components/console/session-header";
import { useWorkspace } from "@/app/components/console/workspace-context";
import { createSession, sessionPath } from "@/lib/api";
import { setPendingRun } from "@/app/lib/ws";

/**
 * Main workspace column for `/console/[userId]`: session header →
 * empty-state conversation → composer.
 *
 * Submitting the first prompt creates a real session through the
 * gateway (which persists the USER message), hands the prompt to the
 * session page via sessionStorage, and navigates to `/session/<id>` —
 * the backend session id is always the source of truth.
 */
export function ConsoleWorkspace() {
  const router = useRouter();
  const { selectedRepo, bindRepository, clearRepository } = useWorkspace();
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function handleSubmit(prompt: string): Promise<boolean> {
    setSubmitError(null);
    try {
      const session = await createSession({
        prompt,
        // Link the repository picked in the composer so the runtime can
        // clone it into the sandbox. Only DB row ids are linkable; a repo
        // that hasn't synced yet simply starts unlinked.
        ...(selectedRepo?.repositoryId
          ? { repositoryId: selectedRepo.repositoryId }
          : {}),
      });
      setPendingRun(session.id, prompt);
      router.push(sessionPath(session.id));
      return true;
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : "Couldn't start the session.");
      return false;
    }
  }

  return (
    <>
      <SessionHeader />
      <AgentWorkspace />
      <Composer
        onSubmit={handleSubmit}
        statusText={submitError ?? undefined}
        statusTone={submitError ? "danger" : undefined}
        repo={selectedRepo}
        repoLocked={false}
        onSelectRepo={bindRepository}
        onClearRepo={clearRepository}
        placeholder="Give Klinpi a task…"
      />
    </>
  );
}
