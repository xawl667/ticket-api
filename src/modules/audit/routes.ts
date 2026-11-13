import { Router } from "express";
import * as auditController from "./controller.js";
import { authenticate } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/auth.js";

export const auditRouter = Router();

auditRouter.use(authenticate);
auditRouter.use(requireRole("SUPER_ADMIN"));

auditRouter.get("/", auditController.getAuditLogs);