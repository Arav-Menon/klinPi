import { WORKSPACE_MAX_FILE_BYTES } from "./config.js";
import { looksBinary } from "./scanner.js";
import { normalizeRelativePath, resolveWithin } from "./paths.js";
import { WorkspaceFileError } from "./types.js";
import type { WorkspaceAdapter, WorkspaceFileContent } from "./types.js";

export interface ReadFileOptions {
    maxBytes?: number;
}

/**
 * Read the contents of a single workspace file for the explorer UI.
 *
 * The caller supplies a *relative* path (untrusted). It is normalized,
 * confined to the workspace root, stat-checked (regular file, size limit),
 * then read with a bounded buffer and screened for binary content.
 */
export async function readWorkspaceFile(
    adapter: WorkspaceAdapter,
    rootAbs: string,
    rawRelPath: string,
    options: ReadFileOptions = {},
): Promise<WorkspaceFileContent> {
    const maxBytes = options.maxBytes ?? WORKSPACE_MAX_FILE_BYTES;

    const relPath = normalizeRelativePath(rawRelPath);
    if (relPath === null) {
        throw new WorkspaceFileError("INVALID_PATH", "Invalid file path");
    }

    const absPath = resolveWithin(rootAbs, relPath);
    if (absPath === null) {
        throw new WorkspaceFileError("INVALID_PATH", "Invalid file path");
    }

    let stat;
    try {
        stat = await adapter.stat(absPath);
    } catch {
        // Deleted between tree listing and content fetch, or never existed.
        throw new WorkspaceFileError("NOT_FOUND", "File not found");
    }

    if (stat.type !== "file") {
        throw new WorkspaceFileError("NOT_A_FILE", "Path is not a regular file");
    }

    if (stat.size > maxBytes) {
        throw new WorkspaceFileError(
            "TOO_LARGE",
            `File is too large to display (limit ${maxBytes} bytes)`,
        );
    }

    let bytes: Uint8Array;
    try {
        bytes = await adapter.read(absPath, maxBytes);
    } catch {
        throw new WorkspaceFileError("NOT_FOUND", "File not found");
    }

    if (looksBinary(bytes)) {
        throw new WorkspaceFileError("BINARY", "Binary files cannot be displayed");
    }

    return {
        path: relPath,
        content: new TextDecoder("utf-8", { fatal: false }).decode(bytes),
        size: stat.size,
        encoding: "utf-8",
    };
}
