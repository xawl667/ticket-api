import type { Request, Response } from "express";
import { loginSchema, acceptInvitationSchema, forgotPasswordSchema, resetPasswordSchema } from "../../shared/schema.js";
import * as authService from "./service.js";

export async function login(req: Request, res: Response) {
  const { email, password } = loginSchema.parse(req.body);
  const result = await authService.login(email, password);
  res.json(result);
}

export async function refresh(req: Request, res: Response) {
  const { refreshToken } = req.body as { refreshToken?: string };
  if (!refreshToken) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const result = await authService.refresh(refreshToken);
  res.json(result);
}

export async function logout(req: Request, res: Response) {
  const { refreshToken } = req.body as { refreshToken?: string };
  if (refreshToken) {
    await authService.logout(refreshToken);
  }
  res.json({ success: true });
}

export async function forgotPassword(req: Request, res: Response) {
  const { email } = forgotPasswordSchema.parse(req.body);
  await authService.forgotPassword(email);
  res.json({ message: "If the account exists and is active, a reset link has been sent" });
}

export async function resetPassword(req: Request, res: Response) {
  const { token, password } = resetPasswordSchema.parse(req.body);
  await authService.resetPassword(token, password);
  res.status(204).send();
}

export async function acceptInvitation(req: Request, res: Response) {
  const { token, password } = acceptInvitationSchema.parse(req.body);
  await authService.acceptInvitation(token, password);
  res.status(204).send();
}

export async function getMe(req: Request, res: Response) {
  const user = await authService.getMe(req.user!.id);
  res.json(user);
}
