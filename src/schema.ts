import { z } from "zod";

export const statusSchema = z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]);

export const createTicketSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1),
});

export const updateStatusSchema = z.object({
  status: statusSchema,
});

export const listQuerySchema = z.object({
  status: statusSchema.optional(),
});

