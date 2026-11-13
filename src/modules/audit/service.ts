import { prisma } from "../../shared/prisma.js";

export type AuditAction =
  | "USER_INVITED"
  | "INVITATION_ACCEPTED"
  | "USER_DISABLED"
  | "USER_ENABLED"
  | "ROLE_CHANGED"
  | "PASSWORD_RESET_COMPLETED";

export interface AuditLogInput {
  actorId: string | null;
  action: AuditAction;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
}

export async function createAuditLog(input: AuditLogInput): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorId: input.actorId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      metadata: input.metadata as any ?? null,
    },
  });
}

export interface AuditLogFilters {
  action?: AuditAction | undefined;
  actorId?: string | undefined;
  targetType?: string | undefined;
  targetId?: string | undefined;
  page?: number | undefined;
  limit?: number | undefined;
  sortBy?: "createdAt" | undefined;
  sortOrder?: "asc" | "desc" | undefined;
}

export interface AuditLogResult {
  data: Array<{
    id: string;
    actorId: string | null;
    action: string;
    targetType: string;
    targetId: string;
    metadata: Record<string, unknown> | string | number | boolean | null | unknown[];
    createdAt: Date;
  }>;
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export async function getAuditLogs(
  filters: AuditLogFilters,
  requesterRole: string
): Promise<AuditLogResult> {
  if (requesterRole !== "SUPER_ADMIN") {
    throw new Error("Forbidden");
  }

  const page = filters.page ?? 1;
  const limit = Math.min(filters.limit ?? 20, 100);
  const sortBy = filters.sortBy ?? "createdAt";
  const sortOrder = filters.sortOrder ?? "desc";

  const where: Record<string, unknown> = {};
  if (filters.action) where.action = filters.action;
  if (filters.actorId) where.actorId = filters.actorId;
  if (filters.targetType) where.targetType = filters.targetType;
  if (filters.targetId) where.targetId = filters.targetId;

  const [data, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { [sortBy]: sortOrder },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        actorId: true,
        action: true,
        targetType: true,
        targetId: true,
        metadata: true,
        createdAt: true,
      },
    }),
    prisma.auditLog.count({ where }),
  ]);

  return {
    data,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}