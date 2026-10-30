import { Router } from "express";
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
