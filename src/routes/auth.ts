import { Router } from "express";
import { prisma } from "../prisma.js";
import { loginSchema } from "../schema.js";
import { verifyPassword, getDummyHash } from "../auth/passwords.js";
import { signAccessToken } from "../auth/tokens.js";
import { authenticate } from "../auth/middleware.js";
import { generateRefreshToken, hashToken, getRefreshTokenExpiry } from "../auth/tokens.js";

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

authRouter.get("/me", authenticate, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: { id: true, email: true, role: true, status: true, createdAt: true },
  });
  res.json(user);
});
