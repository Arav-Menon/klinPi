import { Router } from "express";
import { apiKeyMiddleware } from "../../middleware/apikey.middleware.js";
import type { AuthenticatedRequest } from "../auth/auth.types.js";
import type { Response } from "express";
import * as authService from "../services/auth.service.js";

const router: ReturnType<typeof Router> = Router();

router.get("/me", apiKeyMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const user = await authService.getUserById(userId);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.json({ user });
  } catch (error) {
    console.error("Agent me error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
