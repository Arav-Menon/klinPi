"use client";

import type { WorkspaceFileNode } from "@/app/lib/workspace-files";
import { FileGlyph } from "@/app/components/console/workspace/file-tree";
import { cn } from "cn";

/**
 * "Recent files" section of the workspace Files view — the files the
 * user selected in this workspace session, newest first. Hidden until
 * the first selection so the empty state stays calm.
 */
export function RecentFiles({
  files,
  selectedId,
  onSelect,
}: {
  files: WorkspaceFileNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (files.length === 0) return null;

  return (
    <section aria-label="Recent files" className="mt-3 border-t border-border pt-3">
      <h3 className="px-2 pb-1 text-[11px] font-medium tracking-wide text-faint uppercase">
        Recent files
      </h3>
      <ul>
        {files.map((file) => {
          const selected = file.id === selectedId;
          return (
            <li key={file.id}>
              <button
                type="button"
                aria-current={selected ? "true" : undefined}
                onClick={() => onSelect(file.id)}
                title={file.id}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors duration-[150ms] outline-none",
                  "focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-0",
                  selected
                    ? "bg-accent text-foreground"
                    : "text-subtle hover:bg-accent/60 hover:text-foreground",
                )}
              >
                <FileGlyph name={file.name} className={selected ? "text-foreground" : "text-faint"} />
                <span className="min-w-0 truncate">{file.name}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
