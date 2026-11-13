import type { Request, Response } from "express";
import { createUserSchema } from "../../shared/schema.js";
import { z } from "zod";
import * as usersService from "./service.js";

const idParamSchema = z.object({
  id: z.string().uuid(),
}).strict();

const changeRoleSchema = z.object({
  role: z.enum(["ADMIN", "AGENT", "USER"]),
}).strict();

export async function createUser(req: Request, res: Response) {
  const { email, role } = createUserSchema.parse(req.body);
  const user = await usersService.createUser({ email, role: role ?? "USER" }, req.user!.id);
  res.status(201).json(user);
}

export async function getUsers(req: Request, res: Response) {
  const users = await usersService.getUsers();
  res.json(users);
}

export async function disableUser(req: Request, res: Response) {
  const { id } = idParamSchema.parse(req.params);
  const user = await usersService.disableUser(id, req.user!.id);
  res.json(user);
}

export async function enableUser(req: Request, res: Response) {
  const { id } = idParamSchema.parse(req.params);
  const user = await usersService.enableUser(id, req.user!.id);
  res.json(user);
}

export async function changeUserRole(req: Request, res: Response) {
  const { id } = idParamSchema.parse(req.params);
  const { role } = changeRoleSchema.parse(req.body);
  const user = await usersService.changeUserRole(id, role, req.user!.id);
  res.json(user);
}
