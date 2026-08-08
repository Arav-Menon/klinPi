import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../modules/auth/auth.types.js";
import { authenticateApiKey } from "../modules/services/apikeys.service.js";

export async function apiKeyMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const rawKey = authHeader.slice(7);
  if (!rawKey) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const result = await authenticateApiKey(rawKey);
    if (!result) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    req.userId = result.userId;
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
}
