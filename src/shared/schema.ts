import { z } from "zod";

// Refinement to reject null bytes in strings
const noNullBytes = (val: string) => !val.includes('\u0000');

export const statusSchema = z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]);

export const createTicketSchema = z.object({
  title: z.string().min(1).max(200).refine(noNullBytes, 'Null bytes not allowed'),
  description: z.string().min(1).refine(noNullBytes, 'Null bytes not allowed'),
}).strict();

export const updateStatusSchema = z.object({
  status: statusSchema,
}).strict();

export const listQuerySchema = z.object({
  status: statusSchema.optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().default(20),
  sort: z.enum(["createdAt", "updatedAt", "status"]).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
}).strict();

// Auth schemas
export const loginSchema = z.object({
  email: z.string().email().toLowerCase().refine(noNullBytes, 'Null bytes not allowed'),
  password: z.string().min(1).max(128).refine(noNullBytes, 'Null bytes not allowed'),
}).strict();

export const acceptInvitationSchema = z.object({
  token: z.string().min(1).refine(noNullBytes, 'Null bytes not allowed'),
  password: z.string().min(12).max(72).refine(noNullBytes, 'Null bytes not allowed'),
}).strict();

export const forgotPasswordSchema = z.object({
  email: z.string().email().toLowerCase().refine(noNullBytes, 'Null bytes not allowed'),
}).strict();

export const resetPasswordSchema = z.object({
  token: z.string().min(1).refine(noNullBytes, 'Null bytes not allowed'),
  password: z.string().min(12).max(72).refine(noNullBytes, 'Null bytes not allowed'),
}).strict();

// Users schemas
export const createUserSchema = z.object({
  email: z.string().email().toLowerCase().refine(noNullBytes, 'Null bytes not allowed'),
  role: z.enum(["ADMIN", "AGENT", "USER"]).default("USER"),
}).strict();

export const updateUserStatusSchema = z.object({
  status: z.enum(["ACTIVE", "DISABLED"]),
}).strict();
