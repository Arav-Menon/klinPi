import {Router} from "express";
import {getProfile, updateProfile, patchProfile, deleteProfile, listRepos} from "../controller/user.controller.js";
import {authMiddleware} from "../../middleware/auth.middleware.js";
import {validate} from "../../middleware/validate.js";
import {updateProfileSchema, patchProfileSchema, deleteAccountSchema} from "../../types/validation/user/user.schema.js";
import {profileLimit} from "@klinpi/common";

const router: ReturnType<typeof Router> = Router();

router.get("/profile", authMiddleware, profileLimit, getProfile);
router.put("/profile", authMiddleware, profileLimit, validate(updateProfileSchema), updateProfile);
router.patch("/profile", authMiddleware, profileLimit, validate(patchProfileSchema), patchProfile);
router.delete("/profile", authMiddleware, profileLimit, validate(deleteAccountSchema), deleteProfile);
router.get("/repos", authMiddleware, listRepos);

export default router;
