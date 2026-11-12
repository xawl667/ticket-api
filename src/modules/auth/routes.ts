import { Router } from "express";
import * as authController from "./controller.js";
import { authenticate } from "../../middleware/auth.js";

export const authRouter = Router();

authRouter.post("/login", authController.login);
authRouter.post("/refresh", authController.refresh);
authRouter.post("/logout", authController.logout);
authRouter.post("/forgot-password", authController.forgotPassword);
authRouter.post("/reset-password", authController.resetPassword);
authRouter.post("/accept-invitation", authController.acceptInvitation);
authRouter.get("/me", authenticate, authController.getMe);
