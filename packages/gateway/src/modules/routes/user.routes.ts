import {Router} from "express";
import {getProfile, updateProfile, patchProfile, deleteProfile, listRepos} from "../controller/user.controller.js";
import {authMiddleware} from "../../middleware/auth.middleware.js";
import {validate} from "../../middleware/validate.js";
import {updateProfileSchema, patchProfileSchema, deleteAccountSchema} from "../../types/validation/user/user.schema.js";

const router: ReturnType<typeof Router> = Router();

router.get("/profile", authMiddleware, getProfile);
router.put("/profile", authMiddleware, validate(updateProfileSchema), updateProfile);
router.patch("/profile", authMiddleware, validate(patchProfileSchema), patchProfile);
router.delete("/profile", authMiddleware, validate(deleteAccountSchema), deleteProfile);
router.get("/repos", authMiddleware, listRepos);

export default router;
