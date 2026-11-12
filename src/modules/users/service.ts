import { prisma } from "../../shared/prisma.js";
import { generateRefreshToken, hashToken } from "../auth/tokens.js";
import { sendEmail } from "../../shared/email.js";
import { env } from "../../config/env.js";

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

export async function createUser(data: CreateUserData): Promise<UserResponse> {
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
    throw new Error("Failed to send invitation email");
  }

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
    throw new Error("Cannot disable yourself");
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
      throw new Error("Not found");
    }
    if (result.reason === "last_super_admin") {
      throw new Error("Cannot disable the last active Super Admin");
    }
    throw new Error("Failed to disable user");
  }

  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, role: true, status: true, createdAt: true },
  });
  return user!;
}

export async function enableUser(id: string): Promise<UserResponse> {
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, role: true, status: true, passwordHash: true },
  });

  if (!user) {
    throw new Error("Not found");
  }

  if (user.status !== "DISABLED") {
    throw new Error("User is not disabled");
  }

  const newStatus = user.passwordHash ? "ACTIVE" : "INVITED";

  await prisma.user.update({
    where: { id },
    data: { status: newStatus },
  });

  const updated = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, role: true, status: true, createdAt: true },
  });
  return updated!;
}
