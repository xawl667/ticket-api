import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { createUserSchema } from "../schema.js";
import { authenticate } from "../auth/middleware.js";
import { requireRole } from "../auth/middleware.js";
import { generateRefreshToken, hashToken, getRefreshTokenExpiry } from "../auth/tokens.js";
import { sendEmail } from "../email.js";
import { env } from "../env.js";

export const usersRouter = Router();

usersRouter.use(authenticate);

usersRouter.post(
  "/",
  requireRole("SUPER_ADMIN"),
  async (req, res) => {
    const { email, role } = createUserSchema.parse(req.body);

    const invitationToken = generateRefreshToken();
    const invitationTokenHash = hashToken(invitationToken);
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

    const user = await prisma.user.create({
      data: {
        email,
        role,
        status: "INVITED",
        tokens: {
          create: {
            tokenHash: invitationTokenHash,
            type: "INVITATION",
            expiresAt,
          },
        },
      },
      select: { id: true, email: true, role: true, status: true, createdAt: true },
    });

    await prisma.userToken.updateMany({
      where: {
        userId: user.id,
        type: "INVITATION",
        usedAt: null,
        tokenHash: { not: invitationTokenHash },
      },
      data: { usedAt: new Date() },
    });

    const invitationUrl = `${env.APP_URL}/accept-invitation?token=${invitationToken}`;

    try {
      await sendEmail({
        to: email,
        subject: "Invitation to join Ticket API",
        text: `You have been invited to join Ticket API as ${role}.\n\nAccept your invitation by clicking the link below (valid for 48 hours):\n${invitationUrl}\n\nIf you did not expect this invitation, please ignore this email.`,
      });
    } catch {
      await prisma.user.delete({ where: { id: user.id } });
      return res.status(502).json({ error: "Failed to send invitation email" });
    }

    res.status(201).json(user);
  }
);

usersRouter.get(
  "/",
  requireRole("SUPER_ADMIN", "ADMIN"),
  async (req, res) => {
    const users = await prisma.user.findMany({
      select: { id: true, email: true, role: true, status: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    res.json(users);
  }
);

const idParamSchema = z.object({
  id: z.string().uuid(),
}).strict();

usersRouter.patch(
  "/:id/disable",
  requireRole("SUPER_ADMIN"),
  async (req, res) => {
    const { id } = idParamSchema.parse(req.params);

    if (id === req.user!.id) {
      return res.status(400).json({ error: "Cannot disable yourself" });
    }

    const result = await prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({
        where: { id },
        select: { id: true, role: true, status: true },
      });

      if (!target) {
        return { ok: false as const, reason: "not_found" };
      }

      if (target.role === "SUPER_ADMIN") {
        const activeSuperAdmins = await tx.user.count({
          where: { role: "SUPER_ADMIN", status: "ACTIVE" },
        });
        if (activeSuperAdmins <= 1) {
          return { ok: false as const, reason: "last_super_admin" };
        }
      }

      await tx.user.update({
        where: { id },
        data: { status: "DISABLED" },
      });

      await tx.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      return { ok: true as const };
    });

    if (!result.ok) {
      if (result.reason === "not_found") {
        return res.status(404).json({ error: "Not found" });
      }
      if (result.reason === "last_super_admin") {
        return res.status(400).json({ error: "Cannot disable the last active Super Admin" });
      }
      return res.status(400).json({ error: "Failed to disable user" });
    }

    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, role: true, status: true },
    });
    res.json(user);
  }
);

usersRouter.patch(
  "/:id/enable",
  requireRole("SUPER_ADMIN"),
  async (req, res) => {
    const { id } = idParamSchema.parse(req.params);

    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, role: true, status: true, passwordHash: true },
    });

    if (!user) {
      return res.status(404).json({ error: "Not found" });
    }

    if (user.status !== "DISABLED") {
      return res.status(400).json({ error: "User is not disabled" });
    }

    const newStatus = user.passwordHash ? "ACTIVE" : "INVITED";

    await prisma.user.update({
      where: { id },
      data: { status: newStatus },
    });

    const updated = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, role: true, status: true },
    });
    res.json(updated);
  }
);
