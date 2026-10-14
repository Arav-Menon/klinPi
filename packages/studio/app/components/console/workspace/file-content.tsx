"use client";

import { Loader2, RefreshCw, TriangleAlert, X } from "lucide-react";

import type { WorkspaceContentState } from "@/app/lib/workspace-content";
import { Button } from "@/app/components/ui/button";
import { cn } from "cn";

/**
 * Read-only file content pane for the workspace explorer.
 *
 * Rendered below the file tree (split pane) once a file is selected.
 * States: loading / ready / missing (deleted while open) / unsupported
 * (binary or oversized) / error (recoverable — retry button). Content is
 * plain monospace text for now; a future editor slots in here.
 */

export interface FileContentProps {
  path: string;
  state: WorkspaceContentState;
  onClose: () => void;
  onRetry: () => void;
}

function baseName(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

export function FileContent({ path, state, onClose, onRetry }: FileContentProps) {
  return (
    <section
      aria-label={`Contents of ${path}`}
      className="flex h-[42%] min-h-0 shrink-0 flex-col border-t border-border"
    >
      <header className="flex shrink-0 items-center gap-1.5 border-b border-border px-3 py-1.5">
        <span className="min-w-0 flex-1 truncate text-[11px] tracking-wide text-faint" title={path}>
          <span className="font-medium text-subtle">{baseName(path)}</span>
          {path !== baseName(path) ? ` — ${path.slice(0, path.length - baseName(path).length - 1)}` : null}
        </span>
        {state.status === "ready" || state.status === "loading" ? (
          <button
            type="button"
            aria-label="Reload file"
            onClick={onRetry}
            className="flex size-5 shrink-0 items-center justify-center rounded text-faint transition-colors duration-[150ms] hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-0 outline-none"
          >
            <RefreshCw className={cn("size-3.5", state.status === "loading" && "animate-spin")} aria-hidden="true" />
          </button>
        ) : null}
        <button
          type="button"
          aria-label="Close file"
          onClick={onClose}
          className="flex size-5 shrink-0 items-center justify-center rounded text-faint transition-colors duration-[150ms] hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-0 outline-none"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto overscroll-contain px-3 py-2">
        {state.status === "idle" || state.status === "loading" ? (
          <div className="space-y-2 animate-pulse-soft" aria-hidden="true">
            {[92, 74, 86, 58, 80, 66].map((w, i) => (
              <div key={i} className="h-3.5 rounded bg-white/[0.06]" style={{ width: `${w}%` }} />
            ))}
            {state.status === "loading" ? (
              <span className="sr-only" role="status">
                Loading file…
              </span>
            ) : null}
          </div>
        ) : null}

        {state.status === "ready" ? (
          <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-4 text-subtle">
            {state.file.content}
          </pre>
        ) : null}

        {state.status === "missing" ? (
          <div className="flex h-full flex-col items-center justify-center px-4 text-center">
            <TriangleAlert className="mb-2 size-4 text-faint" aria-hidden="true" />
            <p className="text-[13px] text-subtle">This file no longer exists.</p>
            <p className="mt-1 text-[11px] leading-4 text-faint">
              It was deleted or moved in the workspace.
            </p>
          </div>
        ) : null}

        {state.status === "unsupported" ? (
          <div className="flex h-full flex-col items-center justify-center px-4 text-center">
            <TriangleAlert className="mb-2 size-4 text-faint" aria-hidden="true" />
            <p className="text-[13px] text-subtle">This file can’t be previewed.</p>
            <p className="mt-1 text-[11px] leading-4 text-faint">{state.message}</p>
          </div>
        ) : null}

        {state.status === "error" ? (
          <div className="flex h-full flex-col items-center justify-center px-4 text-center" role="alert">
            <TriangleAlert className="mb-2 size-4 text-faint" aria-hidden="true" />
            <p className="text-[13px] text-subtle">{state.message}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRetry}
              className="mt-3 h-7 px-2.5 text-[13px]"
            >
              <RefreshCw className="size-3.5" aria-hidden="true" /> Retry
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
