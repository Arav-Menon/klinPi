"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, getWsToken } from "@/lib/api";

/**
 * Browser client for the existing realtime WebSocket server
 * (packages/realtime — port 8083, no path routing).
 *
 * Protocol (mirrors packages/realtime/src/app.ts — do not invent frames):
 *  - auth: `?token=<jwt>` (minted via GET /api/v1/auth/ws-token)
 *  - client → server: `{type:"SUBSCRIBE_SESSION", sessionId}` (join),
 *    `{type:"CALL_TO_AGENT", sessionId, userPrompt, repositoryId?}` (run)
 *  - server → client: `{type:"connected"}`, `{type:"error", message}`,
 *    `{type:"AGENT_EVENT", event:{ eventType, content, toolCall,
 *    toolResult, timestamp, sequence, ... }}`
 */

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8083";
const PENDING_RUN_KEY = "klinpi:pending-run:";

const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000];
const MAX_BACKOFF_MS = 15000;

/** Errors after which retrying is pointless (permission won't change). */
const FATAL_ERRORS = new Set(["Not authorized for this session"]);

/** Server errors that mean the dispatched run is over (or never started). */
const RUN_ABORT_ERRORS = new Set([
  "Agent stream failed",
  "Failed to start agent run",
  "Session not found",
  "Failed to create session",
]);

export interface AgentToolCall {
  id?: string;
  name?: string;
  arguments?: string | Record<string, unknown>;
}

export interface AgentToolResult {
  toolCallId?: string;
  output?: string;
  isError?: boolean;
}

/** Normalized `AGENT_EVENT` payload delivered to the UI. */
export interface AgentEvent {
  sessionId?: string;
  eventType: string;
  content?: string;
  toolCall?: AgentToolCall;
  toolResult?: AgentToolResult;
  timestamp?: number | string;
  sequence?: number;
}

export type SocketStatus = "connecting" | "connected" | "reconnecting" | "error";

/**
 * First-prompt handoff: the console stores the prompt under the session id
 * it just created; the session page consumes it once the socket is open
 * (dispatch exactly once — refreshes never re-trigger a run).
 */
export function setPendingRun(sessionId: string, prompt: string): void {
  try {
    sessionStorage.setItem(PENDING_RUN_KEY + sessionId, prompt);
  } catch {
    // Storage unavailable — the run simply won't auto-dispatch.
  }
}

function readPendingRun(sessionId: string): string | null {
  try {
    return sessionStorage.getItem(PENDING_RUN_KEY + sessionId);
  } catch {
    return null;
  }
}

function clearPendingRun(sessionId: string): void {
  try {
    sessionStorage.removeItem(PENDING_RUN_KEY + sessionId);
  } catch {
    // Best effort.
  }
}

export interface UseSessionSocketOptions {
  sessionId: string;
  repositoryId?: string | null;
  /** A normalized agent event arrived from the server. */
  onEvent: (event: AgentEvent) => void;
  /** A non-fatal `{type:"error"}` frame arrived (shown in the conversation). */
  onServerError: (message: string) => void;
  /** The socket re-opened after a drop — reconcile persisted history. */
  onReconnected: () => void;
}

export interface UseSessionSocketResult {
  status: SocketStatus;
  /** An agent run was dispatched and has not completed/failed yet. */
  running: boolean;
  /** Send a follow-up prompt. False when not sendable right now. */
  sendPrompt: (prompt: string) => boolean;
  /** Connection-level failure message (status === "error"). */
  connectionError: string | null;
}

export function useSessionSocket({
  sessionId,
  repositoryId,
  onEvent,
  onServerError,
  onReconnected,
}: UseSessionSocketOptions): UseSessionSocketResult {
  const [status, setStatus] = useState<SocketStatus>("connecting");
  const [running, setRunning] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const hadOpenRef = useRef(false);
  const runningRef = useRef(false);

  // Keep the latest callbacks without re-connecting when identities change.
  const onEventRef = useRef(onEvent);
  const onServerErrorRef = useRef(onServerError);
  const onReconnectedRef = useRef(onReconnected);
  useEffect(() => {
    onEventRef.current = onEvent;
    onServerErrorRef.current = onServerError;
    onReconnectedRef.current = onReconnected;
  });

  const setRunningState = useCallback((value: boolean) => {
    runningRef.current = value;
    setRunning(value);
  }, []);

  const send = useCallback((payload: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(payload));
    return true;
  }, []);

  const dispatchRun = useCallback(
    (prompt: string) => {
      const sent = send({
        type: "CALL_TO_AGENT",
        sessionId,
        userPrompt: prompt,
        ...(repositoryId ? { repositoryId } : {}),
      });
      if (sent) setRunningState(true);
      return sent;
    },
    [send, sessionId, repositoryId, setRunningState],
  );

  const sendPrompt = useCallback(
    (prompt: string): boolean => {
      if (status !== "connected" || runningRef.current) return false;
      return dispatchRun(prompt);
    },
    [status, dispatchRun],
  );

  useEffect(() => {
    // Per-effect stop flag: guards stale handlers (e.g. React strict-mode
    // remounts) from spawning duplicate connections or timers.
    let stopped = false;

    // `status` starts at "connecting"; transitions happen from socket
    // callbacks/timers below (never synchronously from this effect).
    attemptRef.current = 0;
    hadOpenRef.current = false;

    function scheduleReconnect() {
      if (stopped) return;
      const attempt = attemptRef.current;
      const delay = Math.min(
        MAX_BACKOFF_MS,
        BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)] ?? MAX_BACKOFF_MS,
      );
      attemptRef.current = attempt + 1;
      setStatus("reconnecting");
      timerRef.current = setTimeout(connect, delay);
    }

    async function connect() {
      if (stopped) return;

      let token: string;
      try {
        token = await getWsToken();
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          // Cookie expired — retrying can't succeed without re-auth.
          setStatus("error");
          setConnectionError("Your session expired — sign in again.");
          return;
        }
        scheduleReconnect();
        return;
      }
      if (stopped) return;

      let ws: WebSocket;
      try {
        ws = new WebSocket(`${WS_URL}/?token=${encodeURIComponent(token)}`);
      } catch {
        scheduleReconnect();
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        if (stopped) return;
        const isReconnect = hadOpenRef.current;
        hadOpenRef.current = true;
        attemptRef.current = 0;
        setStatus("connected");
        setConnectionError(null);

        // Re-join the session (ownership enforced server-side).
        send({ type: "SUBSCRIBE_SESSION", sessionId });

        // Consume the console → session first-prompt handoff exactly once.
        const pending = readPendingRun(sessionId);
        if (pending !== null && pending.length > 0) {
          if (dispatchRun(pending)) {
            clearPendingRun(sessionId);
          }
        }

        if (isReconnect) onReconnectedRef.current();
      };

      ws.onmessage = (messageEvent) => {
        if (stopped) return;
        let frame: Record<string, unknown>;
        try {
          frame = JSON.parse(String(messageEvent.data)) as Record<string, unknown>;
        } catch {
          return;
        }

        if (frame.type === "AGENT_EVENT" && frame.event) {
          onEventRef.current(frame.event as AgentEvent);
          const eventType = (frame.event as AgentEvent).eventType;
          if (eventType === "AGENT_COMPLETED" || eventType === "AGENT_ERROR") {
            setRunningState(false);
          }
          return;
        }

        if (frame.type === "error") {
          const message =
            typeof frame.message === "string" ? frame.message : "Connection error";

          if (FATAL_ERRORS.has(message)) {
            stopped = true;
            try {
              ws.close();
            } catch {
              // Already closing.
            }
            setStatus("error");
            setConnectionError(message);
            return;
          }

          if (RUN_ABORT_ERRORS.has(message)) setRunningState(false);
          onServerErrorRef.current(message);
        }
        // `{type:"connected"}` — nothing to do.
      };

      ws.onerror = () => {
        // `onclose` always follows; reconnection is handled there.
      };

      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
        if (stopped) return;
        // A run may still be executing server-side, but its completion
        // frame can no longer arrive — re-enable the composer so the
        // UI never wedges in a disabled state.
        setRunningState(false);
        scheduleReconnect();
      };
    }

    void connect();

    return () => {
      stopped = true;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) {
        try {
          ws.close();
        } catch {
          // Already closed.
        }
      }
    };
  }, [sessionId, repositoryId, send, dispatchRun, setRunningState]);

  return { status, running, sendPrompt, connectionError };
}
