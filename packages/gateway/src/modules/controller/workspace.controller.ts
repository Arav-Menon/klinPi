import type { Response } from "express";
import type { AuthenticatedRequest } from "../auth/auth.types.js";
import * as workspaceService from "../services/workspace.service.js";
import type { WorkspaceErrorCode } from "../services/workspace.service.js";

/**
 * Workspace explorer endpoints (session-scoped):
 *   GET /api/v1/sessions/:sessionId/workspace/tree
 *   GET /api/v1/sessions/:sessionId/workspace/file?path=...
 */

function errorStatus(code: WorkspaceErrorCode): number {
  switch (code) {
    case "NOT_FOUND":
      return 404;
    case "TOO_LARGE":
      return 413;
    case "UNAVAILABLE":
      return 502;
    case "INVALID_PATH":
    case "NOT_READY":
    case "BINARY":
    case "NOT_A_FILE":
    default:
      return 400;
  }
}

export async function getWorkspaceTree(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const sessionId = req.params.sessionId as string;
    const result = await workspaceService.getWorkspaceTree(userId, sessionId);

    if (!result) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    if (!result.ok) {
      res.status(errorStatus(result.code)).json({ error: result.message, code: result.code });
      return;
    }

    res.json({ workspace: result.value });
  } catch (error) {
    console.error("Get workspace tree error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}

export async function getWorkspaceFile(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const sessionId = req.params.sessionId as string;
    const { path } = req.query as unknown as { path: string };

    const result = await workspaceService.getWorkspaceFile(userId, sessionId, path);

    if (!result) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    if (!result.ok) {
      const message = result.code === "NOT_FOUND" ? "File not found" : result.message;
      res.status(errorStatus(result.code)).json({ error: message, code: result.code });
      return;
    }

    res.json({ file: result.value });
  } catch (error) {
    console.error("Get workspace file error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}
