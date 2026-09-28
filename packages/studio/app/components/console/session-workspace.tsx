"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { TriangleAlert } from "lucide-react";

import { Conversation } from "@/app/components/console/conversation";
import { Composer } from "@/app/components/console/composer";
import { SessionHeader } from "@/app/components/console/session-header";
import { WorkspaceMenuButton } from "@/app/components/console/workspace/workspace-menu";
import { WorkspacePanel } from "@/app/components/console/workspace/workspace-panel";
import { Sheet, SheetContent, SheetTitle } from "@/app/components/ui/sheet";
import { useWorkspace } from "@/app/components/console/workspace-context";
import {
  applyAgentEvent,
  messagesToItems,
  newUserMessageItem,
  reconcileHistory,
  type ConversationItem,
} from "@/app/lib/agent-events";
import { useSessionSocket, type AgentEvent } from "@/app/lib/ws";
import { useMediaQuery } from "@/app/lib/hooks";
import { getSessionMessages } from "@/lib/api";

/**
 * Session detail workspace (`/session/[sessionId]`):
 * header → split row (chat column: conversation + composer | workspace
 * panel: Files explorer / "Computer" placeholder).
 *
 * Layout: the chat column keeps the previous vertical stack
 * (Conversation `flex-1` scroll + `shrink-0` Composer) untouched; the
 * workspace panel is a sibling with its own scroll region. ≥1024px the
 * panel is inline (open by default), below that it opens as a right
 * side drawer (`Sheet`). Both render the same `WorkspacePanel`.
 *
 * History comes from the gateway (source of truth for persistence); the
 * live stream comes from the existing realtime WebSocket server. The
 * first prompt from the console is dispatched exactly once via the
 * pending-run handshake in `app/lib/ws.ts`.
 */
export function SessionWorkspace() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;
  const { activeSession, repos, bindRepository } = useWorkspace();

  const [items, setItems] = useState<ConversationItem[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyVersion, setHistoryVersion] = useState(0);

  const [panelDismissed, setPanelDismissed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isDesktop = useMediaQuery("(min-width: 1024px)");

  // Inline panel (≥1024px) is open by default until dismissed; below
  // that the same panel opens as a right-side drawer instead.
  function openWorkspace() {
    if (isDesktop) setPanelDismissed(false);
    else setDrawerOpen(true);
  }

  const handleEvent = useCallback((event: AgentEvent) => {
    setItems((prev) => applyAgentEvent(prev, event));
  }, []);

  const handleServerError = useCallback((message: string) => {
    setItems((prev) => [
      ...prev,
      { kind: "error", id: `srv-${Date.now()}-${prev.length}`, content: message },
    ]);
  }, []);

  const handleReconnected = useCallback(() => {
    // Reconcile persisted history after a drop (missed messages were
    // persisted server-side; live tool rows are kept below).
    setHistoryVersion((v) => v + 1);
  }, []);

  const socket = useSessionSocket({
    sessionId,
    repositoryId: activeSession?.repositoryId ?? null,
    onEvent: handleEvent,
    onServerError: handleServerError,
    onReconnected: handleReconnected,
  });

  // Load (and reconcile) persisted history from the gateway.
  useEffect(() => {
    let active = true;

    getSessionMessages(sessionId)
      .then((messages) => {
        if (!active) return;
        const history = messagesToItems(messages);
        setItems((prev) => reconcileHistory(history, prev));
        setHistoryError(null);
        setHistoryLoaded(true);
      })
      .catch((err: unknown) => {
        if (!active) return;
        const message = err instanceof Error ? err.message : "Couldn't load the conversation.";
        setHistoryError(message);
      });

    return () => {
      active = false;
    };
  }, [sessionId, historyVersion]);

  function retryHistory() {
    setHistoryError(null);
    setHistoryVersion((v) => v + 1);
  }

  async function handleSubmit(prompt: string): Promise<boolean> {
    if (!socket.sendPrompt(prompt)) return false;
    setItems((prev) => [...prev, newUserMessageItem(prompt)]);
    return true;
  }

  let statusText: string | undefined;
  let statusTone: "muted" | "danger" = "muted";
  if (socket.status === "error") {
    statusText = socket.connectionError ?? "Realtime disconnected.";
    statusTone = "danger";
  } else if (socket.status === "connecting") {
    statusText = "Connecting…";
  } else if (socket.status === "reconnecting") {
    statusText = "Reconnecting… — messages send when the connection is back.";
  } else if (socket.running) {
    statusText = "Agent working…";
  }

  return (
    <>
      <SessionHeader
        connection={socket.status}
        toolsSlot={<WorkspaceMenuButton onOpenFiles={openWorkspace} />}
      />
      <div className="flex min-h-0 min-w-0 flex-1">
        {/* Chat column — previous layout, unchanged scroll semantics. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {historyError && items.length === 0 ? (
            <section
              aria-label="Conversation"
              className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center"
              role="alert"
            >
              <TriangleAlert className="mb-3 size-5 text-faint" aria-hidden="true" />
              <p className="text-sm text-subtle">{historyError}</p>
              <button
                type="button"
                onClick={retryHistory}
                className="mt-4 rounded-lg border border-border bg-surface-raised px-3 py-1.5 text-sm text-foreground transition-colors duration-[150ms] hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                Retry
              </button>
            </section>
          ) : (
            <Conversation items={items} loading={!historyLoaded} />
          )}
          <Composer
            onSubmit={handleSubmit}
            disabled={socket.status !== "connected" || socket.running}
            statusText={statusText}
            statusTone={statusTone}
            repo={
              activeSession?.repositoryId
                ? (repos.find((r) => r.repositoryId === activeSession.repositoryId) ?? null)
                : null
            }
            repoLocked={Boolean(activeSession?.repositoryId)}
            onSelectRepo={bindRepository}
            placeholder="Reply to Klinpi…"
          />
        </div>

        {/* Inline workspace panel (desktop only, open until dismissed). */}
        {isDesktop && !panelDismissed ? (
          <WorkspacePanel
            sessionId={sessionId}
            onClose={() => setPanelDismissed(true)}
            className="hidden w-[340px] shrink-0 lg:flex xl:w-[380px]"
          />
        ) : null}
      </div>

      {/* Workspace drawer (below 1024px). */}
      {!isDesktop ? (
        <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
          <SheetContent
            side="right"
            showCloseButton={false}
            aria-describedby={undefined}
            // `dark-scope`: the Sheet portals outside the console's
            // dark-scope wrapper — re-map tokens so the drawer stays dark.
            className="dark-scope data-[side=right]:w-[min(400px,92vw)] data-[side=right]:sm:max-w-none gap-0 bg-background p-0"
          >
            <SheetTitle className="sr-only">Workspace</SheetTitle>
            <WorkspacePanel
              sessionId={sessionId}
              onClose={() => setDrawerOpen(false)}
              className="min-h-0 flex-1 border-l-0"
            />
          </SheetContent>
        </Sheet>
      ) : null}
    </>
  );
}
