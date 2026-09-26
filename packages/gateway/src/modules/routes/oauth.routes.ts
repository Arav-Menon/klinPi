import { Router } from "express";
import { githubLogin, githubCallback } from "../controller/oauth.controller.js";

const router: ReturnType<typeof Router> = Router();

router.get("/github", githubLogin);
router.get("/github/callback", githubCallback);

export default router;
