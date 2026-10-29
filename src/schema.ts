import { z } from "zod";

export const statusSchema = z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]);

export const createTicketSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1),
}).strict();

export const updateStatusSchema = z.object({
  status: statusSchema,
}).strict();

export const listQuerySchema = z.object({
  status: statusSchema.optional(),
}).strict();

// Auth schemas
export const loginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(8).max(72),
}).strict();

export const acceptInvitationSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(12).max(72),
}).strict();

export const forgotPasswordSchema = z.object({
  email: z.string().email().toLowerCase(),
}).strict();

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(12).max(72),
}).strict();

// Users schemas
export const createUserSchema = z.object({
  email: z.string().email().toLowerCase(),
  role: z.enum(["ADMIN", "AGENT", "USER"]).default("USER"),
}).strict();

export const updateUserStatusSchema = z.object({
  status: z.enum(["ACTIVE", "DISABLED"]),
}).strict();
