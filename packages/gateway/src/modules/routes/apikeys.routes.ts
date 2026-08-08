import { Router } from "express";
import { createApiKey, listApiKeys, revokeApiKey } from "../controller/apikeys.controller.js";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import { validate } from "../../middleware/validate.js";
import { createApiKeySchema } from "../../types/validation/apikeys/apikeys.schema.js";

const router: ReturnType<typeof Router> = Router();

router.post("/", authMiddleware, validate(createApiKeySchema), createApiKey);
router.get("/", authMiddleware, listApiKeys);
router.delete("/:id", authMiddleware, revokeApiKey);

export default router;
