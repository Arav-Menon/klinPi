import {Router} from "express";
import {signup, signin, logout, me} from "../controller/auth.controller.js";
import {authMiddleware} from "../../middleware/auth.middleware.js";
import {validate} from "../../middleware/validate.js";
import {signupSchema, signinSchema} from "../../types/validation/auth/auth.schema.js";
import {authLimit} from "@klinpi/common"

const router: ReturnType<typeof Router> = Router();

router.post("/signup", validate(signupSchema), authLimit, signup);
router.post("/signin", validate(signinSchema), authLimit, signin);
router.post("/logout", authMiddleware, logout);
router.get("/me", authMiddleware, me);

export default router;
