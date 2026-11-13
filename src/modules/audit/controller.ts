import type { Request, Response } from "express";
import { z } from "zod";
import * as auditService from "./service.js";

const auditActionSchema = z.enum([
  "USER_INVITED",
  "INVITATION_ACCEPTED",
  "USER_DISABLED",
  "USER_ENABLED",
  "ROLE_CHANGED",
  "PASSWORD_RESET_COMPLETED",
]);

const auditQuerySchema = z.object({
  action: auditActionSchema.optional(),
  actorId: z.string().uuid().optional(),
  targetType: z.string().optional(),
  targetId: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  sortBy: z.enum(["createdAt"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
}).strict();

export async function getAuditLogs(req: Request, res: Response) {
  const filters = auditQuerySchema.parse(req.query);
  const result = await auditService.getAuditLogs(filters, req.user!.role);
  res.json(result);
}