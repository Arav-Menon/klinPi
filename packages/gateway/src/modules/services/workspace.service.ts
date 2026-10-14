import * as grpc from "@grpc/grpc-js";
import { getSession } from "./session.service.js";
import {
  getFileTree,
  readFile,
  WorkspaceRpcError,
  type WorkspaceRpcFile,
  type WorkspaceRpcNode,
} from "../../lib/workspace-rpc.js";

/**
 * Workspace explorer operations.
 *
 * Authorization mirrors every other session-scoped service: the session
 * must exist and belong to `userId` (404 otherwise — no data leak). The
 * runtime re-checks ownership over gRPC as defense in depth; the sandbox
 * filesystem is only ever reached through it.
 */

export interface WorkspaceTreeDto {
  status: "ready" | "not_ready";
  rootName: string;
  entries: WorkspaceRpcNode[];
  truncated: boolean;
}

export type WorkspaceErrorCode =
  | "NOT_FOUND"
  | "INVALID_PATH"
  | "NOT_READY"
  | "TOO_LARGE"
  | "BINARY"
  | "NOT_A_FILE"
  | "UNAVAILABLE";

export type WorkspaceResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: WorkspaceErrorCode; message: string };

/** `null` — the session does not exist or belongs to another user. */
export type WorkspaceLookup<T> = WorkspaceResult<T> | null;

function mapRpcError(error: unknown): { code: WorkspaceErrorCode; message: string } {
  if (error instanceof WorkspaceRpcError) {
    switch (error.code) {
      case grpc.status.NOT_FOUND:
        return { code: "NOT_FOUND", message: "Workspace file not found" };
      case grpc.status.INVALID_ARGUMENT:
        return { code: "INVALID_PATH", message: error.message || "Invalid file path" };
      case grpc.status.RESOURCE_EXHAUSTED:
        return { code: "TOO_LARGE", message: error.message || "File is too large" };
      case grpc.status.FAILED_PRECONDITION: {
        if (error.message.includes("not ready")) {
          return { code: "NOT_READY", message: error.message };
        }
        if (error.message.toLowerCase().includes("binary")) {
          return { code: "BINARY", message: error.message };
        }
        if (error.message.toLowerCase().includes("regular file")) {
          return { code: "NOT_A_FILE", message: error.message };
        }
        return { code: "INVALID_PATH", message: error.message };
      }
      case grpc.status.UNAVAILABLE:
      case grpc.status.DEADLINE_EXCEEDED:
        return { code: "UNAVAILABLE", message: "Workspace service unavailable" };
      default:
        console.error("Workspace RPC error:", error.message);
        return { code: "UNAVAILABLE", message: "Workspace service unavailable" };
    }
  }
  console.error("Workspace service error:", error);
  return { code: "UNAVAILABLE", message: "Workspace service unavailable" };
}

export async function getWorkspaceTree(
  userId: string,
  sessionId: string,
): Promise<WorkspaceLookup<WorkspaceTreeDto>> {
  const session = await getSession(userId, sessionId);
  if (!session) return null;

  try {
    const tree = await getFileTree(sessionId, userId);
    return {
      ok: true,
      value: {
        status: tree.status === "ready" ? "ready" : "not_ready",
        rootName: tree.rootName ?? "",
        entries: tree.entries ?? [],
        truncated: Boolean(tree.truncated),
      },
    };
  } catch (error) {
    const mapped = mapRpcError(error);
    return { ok: false, code: mapped.code, message: mapped.message };
  }
}

export async function getWorkspaceFile(
  userId: string,
  sessionId: string,
  filePath: string,
): Promise<WorkspaceLookup<WorkspaceRpcFile>> {
  const session = await getSession(userId, sessionId);
  if (!session) return null;

  try {
    const file = await readFile(sessionId, userId, filePath);
    return { ok: true, value: file };
  } catch (error) {
    const mapped = mapRpcError(error);
    return { ok: false, code: mapped.code, message: mapped.message };
  }
}
