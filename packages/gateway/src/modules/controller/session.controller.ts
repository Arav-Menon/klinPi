import type { Response } from "express";
import type { AuthenticatedRequest } from "../auth/auth.types.js";
import * as sessionService from "../services/session.service.js";

export async function createSession(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { title, repositoryId } = req.body;
    const session = await sessionService.createSession(userId, {
      title,
      repositoryId,
    });

    res.status(201).json({ session });
  } catch (error) {
    console.error("Create session error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}

export async function getSession(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const sessionId = req.params.sessionId as string;
    const session = await sessionService.getSession(userId, sessionId);

    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    res.json({ session });
  } catch (error) {
    console.error("Get session error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}

export async function updateSession(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const sessionId = req.params.sessionId as string;
    const { title, status } = req.body;

    const session = await sessionService.updateSession(userId, sessionId, {
      title,
      status,
    });

    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    res.json({ session });
  } catch (error) {
    console.error("Update session error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}

export async function archiveSession(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const sessionId = req.params.sessionId as string;
    const result = await sessionService.archiveSession(userId, sessionId);

    if (!result) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    if (result === "ALREADY_ARCHIVED") {
      res.status(400).json({ error: "Session is already archived" });
      return;
    }

    res.json({ message: "Session archived successfully" });
  } catch (error) {
    console.error("Archive session error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}

export async function getRecentSessions(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { limit, cursor } = req.query as { limit?: number; cursor?: string };
    const result = await sessionService.getRecentSessions(
      userId,
      limit ?? 20,
      cursor,
    );

    res.json(result);
  } catch (error) {
    console.error("Get recent sessions error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}

export async function searchSessions(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { q, limit } = req.query as unknown as { q: string; limit?: number };
    const sessions = await sessionService.searchSessions(
      userId,
      q,
      limit ?? 20,
    );

    res.json({ sessions });
  } catch (error) {
    console.error("Search sessions error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}
