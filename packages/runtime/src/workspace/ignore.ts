/**
 * Centralized workspace ignore rules.
 *
 * Matching is exact-basename only (never substring) so a legitimate source
 * folder is not hidden just because its name resembles a build artifact.
 * The same list is applied by the tree scanner and the filesystem watcher.
 */
export const IGNORED_DIR_NAMES: ReadonlySet<string> = new Set([
    ".git",
    "node_modules",
    "dist",
    "build",
    ".next",
    ".nuxt",
    ".cache",
    ".turbo",
    ".parcel-cache",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    "__pycache__",
    ".venv",
    "venv",
    "coverage",
    ".gradle",
    "target",
]);

export function isIgnoredDir(name: string): boolean {
    return IGNORED_DIR_NAMES.has(name);
}
