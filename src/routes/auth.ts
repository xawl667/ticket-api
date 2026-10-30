import { Router } from "express";
import { prisma } from "../prisma.js";
import { loginSchema, acceptInvitationSchema, forgotPasswordSchema, resetPasswordSchema } from "../schema.js";
import { verifyPassword, getDummyHash, hashPassword } from "../auth/passwords.js";
import { signAccessToken } from "../auth/tokens.js";
import { authenticate } from "../auth/middleware.js";
import { generateRefreshToken, hashToken, getRefreshTokenExpiry } from "../auth/tokens.js";
import { sendEmail } from "../email.js";
import { env } from "../env.js";
import { randomBytes } from "crypto";

export const authRouter = Router();

authRouter.post("/login", async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, passwordHash: true, role: true, status: true },
  });

  const hashToCheck = user?.passwordHash ?? getDummyHash();
  const isValid = await verifyPassword(password, hashToCheck);

  if (!user || !isValid || user.status !== "ACTIVE") {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const familyId = crypto.randomUUID();
  const refreshToken = generateRefreshToken();
  const refreshTokenHash = hashToken(refreshToken);
  const expiresAt = getRefreshTokenExpiry();

  await prisma.refreshToken.create({
    data: {
      tokenHash: refreshTokenHash,
      userId: user.id,
      familyId,
      expiresAt,
    },
  });

  const accessToken = signAccessToken({ sub: user.id, role: user.role });
  res.json({ accessToken, refreshToken });
});

authRouter.post("/refresh", async (req, res) => {
  const { refreshToken } = req.body as { refreshToken?: string };
  if (!refreshToken) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const tokenHash = hashToken(refreshToken);

  const result = await prisma.$transaction(async (tx) => {
    const stored = await tx.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: { select: { id: true, role: true, status: true } } },
    });

    if (!stored) {
      return { ok: false, reason: "not_found" as const };
    }

    if (stored.revokedAt) {
      await tx.refreshToken.updateMany({
        where: { familyId: stored.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return { ok: false, reason: "reuse" as const };
    }

    if (stored.expiresAt < new Date()) {
      return { ok: false, reason: "expired" as const };
    }

    if (stored.user.status !== "ACTIVE") {
      return { ok: false, reason: "inactive" as const };
    }

    const revoked = await tx.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    if (revoked.count !== 1) {
      await tx.refreshToken.updateMany({
        where: { familyId: stored.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return { ok: false, reason: "reuse" as const };
    }

    const newFamilyId = stored.familyId;
    const newRefreshToken = generateRefreshToken();
    const newRefreshTokenHash = hashToken(newRefreshToken);
    const newExpiresAt = getRefreshTokenExpiry();

    const newToken = await tx.refreshToken.create({
      data: {
        tokenHash: newRefreshTokenHash,
        userId: stored.userId,
        familyId: newFamilyId,
        expiresAt: newExpiresAt,
        replacedById: null,
      },
    });

    await tx.refreshToken.update({
      where: { id: stored.id },
      data: { replacedById: newToken.id },
    });

    const accessToken = signAccessToken({ sub: stored.user.id, role: stored.user.role });

    return { ok: true as const, accessToken, refreshToken: newRefreshToken };
  });

  if (!result.ok) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  res.json({ accessToken: result.accessToken, refreshToken: result.refreshToken });
});

authRouter.post("/logout", async (req, res) => {
  const { refreshToken } = req.body as { refreshToken?: string };
  if (!refreshToken) {
    return res.json({ success: true });
  }

  const tokenHash = hashToken(refreshToken);

  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash },
  });

  if (stored) {
    await prisma.refreshToken.updateMany({
      where: { familyId: stored.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  res.json({ success: true });
});

authRouter.post("/forgot-password", async (req, res) => {
  const { email } = forgotPasswordSchema.parse(req.body);

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, status: true },
  });

  const genericResponse = { message: "If the account exists and is active, a reset link has been sent" };
  res.json(genericResponse);

  if (!user || user.status !== "ACTIVE") {
    return;
  }

  const resetToken = randomBytes(32).toString("base64url");
  const resetTokenHash = hashToken(resetToken);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

  await prisma.userToken.create({
    data: {
      userId: user.id,
      tokenHash: resetTokenHash,
      type: "PASSWORD_RESET",
      expiresAt,
    },
  });

  await prisma.userToken.updateMany({
    where: {
      userId: user.id,
      type: "PASSWORD_RESET",
      usedAt: null,
      tokenHash: { not: resetTokenHash },
    },
    data: { usedAt: new Date() },
  });

  const resetUrl = `${env.APP_URL}/reset-password?token=${resetToken}`;

  sendEmail({
    to: email,
    subject: "Password Reset",
    text: `You requested a password reset.\n\nClick the link below to reset your password (valid for 1 hour):\n${resetUrl}\n\nIf you did not request this, please ignore this email.`,
  }).catch((err) => {
    console.error("Failed to send reset email:", err instanceof Error ? err.message : "Unknown error");
  });
});

authRouter.post("/reset-password", async (req, res) => {
  const { token, password } = resetPasswordSchema.parse(req.body);
  const tokenHash = hashToken(token);

  const passwordHash = await hashPassword(password);

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.userToken.updateMany({
      where: {
        tokenHash,
        type: "PASSWORD_RESET",
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { usedAt: new Date() },
    });

    if (updated.count !== 1) {
      return { ok: false as const };
    }

    const userToken = await tx.userToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!userToken || userToken.user.status !== "ACTIVE") {
      return { ok: false as const };
    }

    await tx.user.update({
      where: { id: userToken.userId },
      data: { passwordHash },
    });

    await tx.refreshToken.updateMany({
      where: { userId: userToken.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    return { ok: true as const };
  });

  if (!result.ok) {
    return res.status(400).json({ error: "Invalid or expired token" });
  }

  res.status(204).send();
});

authRouter.post("/accept-invitation", async (req, res) => {
  const { token, password } = acceptInvitationSchema.parse(req.body);
  const tokenHash = hashToken(token);

  const passwordHash = await hashPassword(password);

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.userToken.updateMany({
      where: {
        tokenHash,
        type: "INVITATION",
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { usedAt: new Date() },
    });

    if (updated.count !== 1) {
      return { ok: false as const };
    }

    const userToken = await tx.userToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!userToken || userToken.user.status !== "INVITED") {
      return { ok: false as const };
    }

    await tx.user.update({
      where: { id: userToken.userId },
      data: { passwordHash, status: "ACTIVE" },
    });

    return { ok: true as const };
  });

  if (!result.ok) {
    return res.status(400).json({ error: "Invalid or expired token" });
  }

  res.status(204).send();
});

authRouter.get("/me", authenticate, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: { id: true, email: true, role: true, status: true, createdAt: true },
  });
  res.json(user);
});
