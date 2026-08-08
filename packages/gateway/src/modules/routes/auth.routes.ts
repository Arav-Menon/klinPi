import { Router } from "express";
import { signup, signin, logout, me } from "../controller/auth.controller.js";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import { validate } from "../../middleware/validate.js";
import { signupSchema, signinSchema } from "../../types/validation/auth/auth.schema.js";

const router: ReturnType<typeof Router> = Router();

router.post("/signup", validate(signupSchema), signup);
router.post("/signin", validate(signinSchema), signin);
router.post("/logout", authMiddleware, logout);
router.get("/me", authMiddleware, me);

export default router;
