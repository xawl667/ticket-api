import { prisma } from "../../shared/prisma.js";
import { generateRefreshToken, hashToken } from "../auth/tokens.js";
import { sendEmail } from "../../shared/email.js";
import { env } from "../../config/env.js";
import { AppError } from "../../shared/errors.js";
import { createAuditLog, type AuditAction } from "../audit/service.js";

export interface CreateUserData {
  email: string;
  role: "ADMIN" | "AGENT" | "USER";
}

export interface UserResponse {
  id: string;
  email: string;
  role: string;
  status: string;
  createdAt: Date;
}

export async function createUser(data: CreateUserData, actorId: string): Promise<UserResponse> {
  const invitationToken = generateRefreshToken();
  const invitationTokenHash = hashToken(invitationToken);
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

  const user = await prisma.user.create({
    data: {
      email: data.email.toLowerCase(),
      role: data.role,
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
      to: data.email,
      subject: "Invitation to join Ticket API",
      text: `You have been invited to join Ticket API as ${data.role}.\n\nAccept your invitation by clicking the link below (valid for 48 hours):\n${invitationUrl}\n\nIf you did not expect this invitation, please ignore this email.`,
    });
  } catch {
    await prisma.user.delete({ where: { id: user.id } });
    throw AppError.badGateway("Failed to send invitation email", "EMAIL_SEND_FAILED");
  }

  await createAuditLog({
    actorId,
    action: "USER_INVITED",
    targetType: "User",
    targetId: user.id,
    metadata: { role: data.role, email: data.email },
  });

  return user;
}

export async function getUsers(): Promise<UserResponse[]> {
  return prisma.user.findMany({
    select: { id: true, email: true, role: true, status: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function disableUser(id: string, requesterId: string): Promise<UserResponse> {
  if (id === requesterId) {
    throw AppError.badRequest("Cannot disable yourself", "CANNOT_DISABLE_SELF");
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
      throw AppError.notFound("Not found", "NOT_FOUND");
    }
    if (result.reason === "last_super_admin") {
      throw AppError.badRequest("Cannot disable the last active Super Admin", "LAST_SUPER_ADMIN");
    }
    throw AppError.internal("Failed to disable user", "DISABLE_FAILED");
  }

  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, role: true, status: true, createdAt: true },
  });

  await createAuditLog({
    actorId: requesterId,
    action: "USER_DISABLED",
    targetType: "User",
    targetId: id,
    metadata: { previousStatus: "ACTIVE", newStatus: "DISABLED" },
  });

  return user!;
}

export async function enableUser(id: string, requesterId: string): Promise<UserResponse> {
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, role: true, status: true, passwordHash: true },
  });

  if (!user) {
    throw AppError.notFound("Not found", "NOT_FOUND");
  }

  if (user.status !== "DISABLED") {
    throw AppError.badRequest("User is not disabled", "USER_NOT_DISABLED");
  }

  const newStatus = user.passwordHash ? "ACTIVE" : "INVITED";

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id },
      data: { status: newStatus },
    });
  });

  await createAuditLog({
    actorId: requesterId,
    action: "USER_ENABLED",
    targetType: "User",
    targetId: id,
    metadata: { previousStatus: "DISABLED", newStatus },
  });

  const updated = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, role: true, status: true, createdAt: true },
  });
  return updated!;
}

export async function changeUserRole(
  id: string,
  newRole: "ADMIN" | "AGENT" | "USER",
  requesterId: string
): Promise<UserResponse> {
  if (id === requesterId) {
    throw AppError.badRequest("Cannot change your own role", "CANNOT_CHANGE_OWN_ROLE");
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
      // newRole is never SUPER_ADMIN (it's ADMIN | AGENT | USER), so this is always a demotion
      if (activeSuperAdmins <= 1) {
        return { ok: false as const, reason: "last_super_admin" };
      }
    }

    await tx.user.update({
      where: { id },
      data: { role: newRole },
    });

    return { ok: true as const, previousRole: target.role };
  });

  if (!result.ok) {
    if (result.reason === "not_found") {
      throw AppError.notFound("Not found", "NOT_FOUND");
    }
    if (result.reason === "last_super_admin") {
      throw AppError.badRequest("Cannot demote the last active Super Admin", "LAST_SUPER_ADMIN");
    }
    throw AppError.internal("Failed to change user role", "ROLE_CHANGE_FAILED");
  }

  await createAuditLog({
    actorId: requesterId,
    action: "ROLE_CHANGED",
    targetType: "User",
    targetId: id,
    metadata: { previousRole: result.previousRole, newRole },
  });

  const updated = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, role: true, status: true, createdAt: true },
  });
  return updated!;
}