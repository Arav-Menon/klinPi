import { Router } from "express";
import {
  createSession,
  getSession,
  updateSession,
  archiveSession,
  getRecentSessions,
  searchSessions,
} from "../controller/session.controller.js";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import { validate } from "../../middleware/validate.js";
import { validateQuery } from "../../middleware/validateQuery.js";
import {
  createSessionSchema,
  updateSessionSchema,
  recentSessionsSchema,
  searchSessionsSchema,
} from "../../types/validation/session/session.schema.js";

const router: ReturnType<typeof Router> = Router();

router.post("/", authMiddleware, validate(createSessionSchema), createSession);
router.get("/recent", authMiddleware, validateQuery(recentSessionsSchema), getRecentSessions);
router.get("/search", authMiddleware, validateQuery(searchSessionsSchema), searchSessions);
router.get("/:sessionId", authMiddleware, getSession);
router.patch("/:sessionId", authMiddleware, validate(updateSessionSchema), updateSession);
router.delete("/:sessionId", authMiddleware, archiveSession);

export default router;
