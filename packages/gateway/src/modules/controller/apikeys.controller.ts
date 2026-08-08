import type { Response } from "express";
import type { AuthenticatedRequest } from "../auth/auth.types.js";
import * as apikeysService from "../services/apikeys.service.js";

export async function createApiKey(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { name } = req.body;
    const result = await apikeysService.createApiKey(userId, name);
    res.status(201).json(result);
  } catch (error) {
    console.error("Create API key error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}

export async function listApiKeys(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const keys = await apikeysService.listApiKeys(userId);
    res.json(keys);
  } catch (error) {
    console.error("List API keys error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}

export async function revokeApiKey(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const id = req.params.id as string;
    if (!id) {
      res.status(400).json({ error: "Invalid key ID" });
      return;
    }
    const result = await apikeysService.revokeApiKey(userId, id);
    if (!result) {
      res.status(404).json({ error: "API key not found" });
      return;
    }

    res.json(result);
  } catch (error) {
    console.error("Revoke API key error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}
