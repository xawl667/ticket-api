import { prisma } from "../../shared/prisma.js";
import { verifyPassword, getDummyHash, hashPassword } from "./passwords.js";
import { signAccessToken } from "./tokens.js";
import { generateRefreshToken, hashToken, getRefreshTokenExpiry } from "./tokens.js";
import { sendEmail } from "../../shared/email.js";
import { env } from "../../config/env.js";
import { randomBytes, randomUUID } from "crypto";
import { AppError } from "../../shared/errors.js";
import { createAuditLog, type AuditAction } from "../audit/service.js";

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
}

export interface RefreshResult {
  accessToken: string;
  refreshToken: string;
}

interface RefreshErrorResult {
  ok: false;
  reason: "not_found" | "reuse" | "expired" | "inactive";
}

interface RefreshSuccessResult {
  ok: true;
  accessToken: string;
  refreshToken: string;
}

type RefreshTransactionResult = RefreshErrorResult | RefreshSuccessResult;

export interface TokenPayload {
  sub: string;
  role: string;
}

export async function login(email: string, password: string): Promise<LoginResult> {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    select: { id: true, passwordHash: true, role: true, status: true },
  });

  const hashToCheck = user?.passwordHash ?? getDummyHash();
  const isValid = await verifyPassword(password, hashToCheck);

  if (!user || !isValid || user.status !== "ACTIVE") {
    throw AppError.unauthorized("Invalid credentials", "INVALID_CREDENTIALS");
  }

  const familyId = randomUUID();
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

  const accessToken = signAccessToken({ sub: user.id, role: user.role, sid: familyId });
  return { accessToken, refreshToken };
}

export async function refresh(refreshToken: string): Promise<RefreshResult> {
  if (!refreshToken) {
    throw AppError.unauthorized("Unauthorized", "UNAUTHORIZED");
  }

  const tokenHash = hashToken(refreshToken);

  const result = await prisma.$transaction(async (tx): Promise<RefreshTransactionResult> => {
    const stored = await tx.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: { select: { id: true, role: true, status: true } } },
    });

    if (!stored) {
      return { ok: false, reason: "not_found" };
    }

    if (stored.revokedAt) {
      await tx.refreshToken.updateMany({
        where: { familyId: stored.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return { ok: false, reason: "reuse" };
    }

    if (stored.expiresAt < new Date()) {
      return { ok: false, reason: "expired" };
    }

    if (stored.user.status !== "ACTIVE") {
      return { ok: false, reason: "inactive" };
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
      return { ok: false, reason: "reuse" };
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

    const accessToken = signAccessToken({ sub: stored.user.id, role: stored.user.role, sid: stored.familyId });

    return { ok: true, accessToken, refreshToken: newRefreshToken };
  });

  if (!result.ok) {
    throw AppError.unauthorized("Unauthorized", "UNAUTHORIZED");
  }

  return { accessToken: result.accessToken, refreshToken: result.refreshToken };
}

export async function logout(refreshToken: string): Promise<void> {
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
}

export async function forgotPassword(email: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    select: { id: true, status: true },
  });

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
}

export async function resetPassword(token: string, password: string): Promise<void> {
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

    return { ok: true as const, userId: userToken.userId };
  });

  if (!result.ok) {
    throw AppError.badRequest("Invalid or expired token", "INVALID_OR_EXPIRED_TOKEN");
  }

  await createAuditLog({
    actorId: result.userId,
    action: "PASSWORD_RESET_COMPLETED",
    targetType: "User",
    targetId: result.userId,
    metadata: {},
  });
}

export async function acceptInvitation(token: string, password: string): Promise<void> {
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

    return { ok: true as const, userId: userToken.userId };
  });

  if (!result.ok) {
    throw AppError.badRequest("Invalid or expired token", "INVALID_OR_EXPIRED_TOKEN");
  }

  await createAuditLog({
    actorId: result.userId,
    action: "INVITATION_ACCEPTED",
    targetType: "User",
    targetId: result.userId,
    metadata: {},
  });
}

export async function getMe(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, role: true, status: true, createdAt: true },
  });
  return user;
}
