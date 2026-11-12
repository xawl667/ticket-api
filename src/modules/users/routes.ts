import { Router } from "express";
import * as usersController from "./controller.js";
import { authenticate } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/auth.js";

export const usersRouter = Router();

usersRouter.use(authenticate);

usersRouter.post("/", requireRole("SUPER_ADMIN"), usersController.createUser);
usersRouter.get("/", requireRole("SUPER_ADMIN", "ADMIN"), usersController.getUsers);
usersRouter.patch("/:id/disable", requireRole("SUPER_ADMIN"), usersController.disableUser);
usersRouter.patch("/:id/enable", requireRole("SUPER_ADMIN"), usersController.enableUser);
