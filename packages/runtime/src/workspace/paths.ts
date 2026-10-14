import path from "node:path";

/**
 * Workspace path handling. The browser only ever supplies a path *relative*
 * to the workspace root — nothing here trusts it until it has been
 * normalized and proven to resolve inside the root.
 */

/**
 * Normalize a client-supplied relative path.
 *
 * Accepts an optional leading `/`, collapses `.` segments, and rejects
 * anything that could escape the root (`..` segments, NUL bytes, absolute
 * paths with a Windows drive, empty results). Returns the canonical
 * slash-separated relative path, or `null` when the input is invalid.
 */
export function normalizeRelativePath(raw: string): string | null {
    if (typeof raw !== "string") return null;
    if (raw.includes("\0")) return null;

    const trimmed = raw.trim();
    if (!trimmed) return null;

    // Reject drive-qualified paths (e.g. "C:\\windows") outright.
    if (/^[a-zA-Z]:/.test(trimmed)) return null;

    const slashNormalized = trimmed.replaceAll("\\", "/");
    const segments = slashNormalized.split("/").filter((segment) => segment !== "" && segment !== ".");
    if (segments.length === 0) return null;

    if (segments.some((segment) => segment === "..")) return null;

    return segments.join("/");
}

/**
 * Resolve `relPath` against `rootAbs` and verify the result stays inside the
 * root. Returns the absolute path, or `null` on traversal / invalid input.
 */
export function resolveWithin(rootAbs: string, relPath: string): string | null {
    const normalized = normalizeRelativePath(relPath);
    if (normalized === null) return null;

    const root = path.resolve(rootAbs);
    const candidate = path.resolve(root, normalized);
    if (candidate === root) return null;
    if (!candidate.startsWith(root + path.sep)) return null;
    return candidate;
}

/** Convert an absolute path inside the root to a canonical relative path. */
export function toRelativePath(rootAbs: string, absPath: string): string {
    const root = path.resolve(rootAbs);
    const resolved = path.resolve(absPath);
    if (resolved === root) return "";
    const rel = path.relative(root, resolved);
    return rel.split(path.sep).join("/");
}

/** Last path segment of a relative workspace path (the display name). */
export function baseName(relPath: string): string {
    const segments = relPath.split("/").filter(Boolean);
    return segments[segments.length - 1] ?? relPath;
}
