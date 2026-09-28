"use client";

import { useState } from "react";
import {
  ChevronRight,
  File,
  FileCode,
  FileCode2,
  FileJson,
  FileText,
  Folder,
  FolderOpen,
  type LucideIcon,
} from "lucide-react";

import {
  defaultExpandedIds,
  type WorkspaceFileNode,
  type WorkspaceFileTree,
} from "@/app/lib/workspace-files";
import { cn } from "cn";

/**
 * File explorer tree (workspace panel).
 *
 * Presentational only — nodes come from the `WorkspaceDataSource`
 * boundary (`app/lib/workspace-files.ts`), never inline mock data.
 * Folders toggle via `aria-expanded` buttons, files select via
 * `aria-selected` buttons; every row is keyboard reachable (Tab/Enter).
 */

const EXTENSION_ICONS: Record<string, LucideIcon> = {
  js: FileCode2,
  jsx: FileCode2,
  ts: FileCode2,
  tsx: FileCode2,
  json: FileJson,
  md: FileText,
  txt: FileText,
  css: FileCode,
  scss: FileCode,
  html: FileCode,
  yml: FileText,
  yaml: FileText,
};

/** Type-aware file glyph (falls back to a plain document). */
export function FileGlyph({ name, className }: { name: string; className?: string }) {
  const Icon =
    EXTENSION_ICONS[name.includes(".") ? (name.split(".").pop() ?? "").toLowerCase() : ""] ??
    (name.startsWith(".") ? FileText : File);
  return <Icon className={cn("size-3.5 shrink-0", className)} aria-hidden="true" />;
}

/** Shared row chrome for folder/file rows. */
const ROW_CLASS =
  "flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-[13px] leading-5 transition-colors duration-[150ms] outline-none";

const FOCUS_CLASS = "focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-0";

/** Indentation: 14px per depth level (dynamic depth → inline style). */
function indent(depth: number): React.CSSProperties {
  return { paddingLeft: `${8 + depth * 14}px` };
}

interface FolderNodeProps {
  node: WorkspaceFileNode;
  depth: number;
  expandedIds: Set<string>;
  selectedId: string | null;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
}

function FolderNode({
  node,
  depth,
  expandedIds,
  selectedId,
  onToggle,
  onSelect,
}: FolderNodeProps) {
  const expanded = expandedIds.has(node.id);

  return (
    <li role="treeitem" aria-expanded={expanded} aria-selected={selectedId === node.id}>
      <button
        type="button"
        onClick={() => onToggle(node.id)}
        style={indent(depth)}
        className={cn(ROW_CLASS, FOCUS_CLASS, "text-subtle hover:bg-accent/60 hover:text-foreground")}
      >
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 text-faint transition-transform duration-[150ms]",
            expanded && "rotate-90",
          )}
          aria-hidden="true"
        />
        {expanded ? (
          <FolderOpen className="size-3.5 shrink-0 text-faint" aria-hidden="true" />
        ) : (
          <Folder className="size-3.5 shrink-0 text-faint" aria-hidden="true" />
        )}
        <span className="min-w-0 truncate">{node.name}</span>
      </button>

      {expanded && node.children && node.children.length > 0 ? (
        <ul role="group">
          <FileNodes
            nodes={node.children}
            depth={depth + 1}
            expandedIds={expandedIds}
            selectedId={selectedId}
            onToggle={onToggle}
            onSelect={onSelect}
          />
        </ul>
      ) : null}
    </li>
  );
}

interface FileNodeProps {
  node: WorkspaceFileNode;
  depth: number;
  selected: boolean;
  onSelect: (id: string) => void;
}

function FileNode({ node, depth, selected, onSelect }: FileNodeProps) {
  return (
    <li role="treeitem" aria-selected={selected}>
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(node.id)}
        style={indent(depth)}
        title={node.name}
        className={cn(
          ROW_CLASS,
          FOCUS_CLASS,
          selected
            ? "bg-accent text-foreground"
            : "text-subtle hover:bg-accent/60 hover:text-foreground",
        )}
      >
        <FileGlyph name={node.name} className={selected ? "text-foreground" : "text-faint"} />
        <span className="min-w-0 truncate">{node.name}</span>
      </button>
    </li>
  );
}

interface FileNodesProps {
  nodes: WorkspaceFileNode[];
  depth: number;
  expandedIds: Set<string>;
  selectedId: string | null;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
}

function FileNodes({ nodes, depth, expandedIds, selectedId, onToggle, onSelect }: FileNodesProps) {
  return (
    <>
      {nodes.map((node) =>
        node.kind === "folder" ? (
          <FolderNode
            key={node.id}
            node={node}
            depth={depth}
            expandedIds={expandedIds}
            selectedId={selectedId}
            onToggle={onToggle}
            onSelect={onSelect}
          />
        ) : (
          <FileNode
            key={node.id}
            node={node}
            depth={depth}
            selected={node.id === selectedId}
            onSelect={onSelect}
          />
        ),
      )}
    </>
  );
}

export interface FileTreeProps {
  tree: WorkspaceFileTree;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function FileTree({ tree, selectedId, onSelect }: FileTreeProps) {
  // The root and the next two folder levels start expanded so the tree
  // reads at a glance (and overflows its scroll region like a real repo).
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() =>
    defaultExpandedIds(tree.entries),
  );

  function handleToggle(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <ul role="tree" aria-label={`Files in ${tree.rootName}`}>
      <FileNodes
        nodes={tree.entries}
        depth={0}
        expandedIds={expandedIds}
        selectedId={selectedId}
        onToggle={handleToggle}
        onSelect={onSelect}
      />
    </ul>
  );
}
