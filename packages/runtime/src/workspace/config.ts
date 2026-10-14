import {
    WORKSPACE_MAX_FILE_BYTES,
    WORKSPACE_MAX_TREE_DEPTH,
    WORKSPACE_MAX_TREE_ENTRIES,
    WORKSPACE_WATCH_DEBOUNCE_MS,
} from "@klinpi/common";

export { WORKSPACE_MAX_FILE_BYTES, WORKSPACE_MAX_TREE_DEPTH, WORKSPACE_MAX_TREE_ENTRIES, WORKSPACE_WATCH_DEBOUNCE_MS };

/** Bytes sampled from the head of a file to detect binary content. */
export const BINARY_SNIFF_BYTES = 8192;

/** Coalescing window for filesystem watch events (env-overridable above). */
export const WATCH_DEBOUNCE_MS = WORKSPACE_WATCH_DEBOUNCE_MS;

/** Flush early once this many raw events are buffered. */
export const WATCH_BATCH_CAP = 100;

/** Maximum consecutive watch restarts before giving up until the next ensure. */
export const WATCH_MAX_RESTARTS = 5;

/** Base delay between watch restarts (doubles per attempt). */
export const WATCH_RESTART_BASE_MS = 1000;

/** How long an identical in-flight/coalesced tree scan is reused. */
export const TREE_SCAN_COALESCE_MS = 1000;

/** gRPC deadlines for workspace RPCs (gateway side uses matching budgets). */
export const WORKSPACE_RPC_TIMEOUT_MS = 15_000;
