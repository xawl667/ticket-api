import { prisma } from "../../shared/prisma.js";
import { Prisma } from "@prisma/client";
import { AppError } from "../../shared/errors.js";

export interface CreateTicketData {
  title: string;
  description: string;
}

export interface UpdateStatusData {
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
}

export interface TicketFilters {
  status?: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED" | undefined;
  page?: number | undefined;
  limit?: number | undefined;
  sort?: "createdAt" | "updatedAt" | "status" | undefined;
  order?: "asc" | "desc" | undefined;
}

export interface UserContext {
  id: string;
  role: string;
}

export interface PaginatedTickets {
  data: Array<{
    id: string;
    title: string;
    description: string;
    status: string;
    createdAt: Date;
    updatedAt: Date;
    createdById: string | null;
    assignedToId: string | null;
  }>;
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export async function createTicket(data: CreateTicketData, user: UserContext) {
  return prisma.ticket.create({
    data: { ...data, createdById: user.id },
  });
}

export async function getTickets(filters: TicketFilters, user: UserContext): Promise<PaginatedTickets> {
  const page = filters.page ?? 1;
  const limit = Math.min(filters.limit ?? 20, 100);
  const sort = filters.sort ?? "createdAt";
  const order = filters.order ?? "desc";

  const where: Prisma.TicketWhereInput = filters.status ? { status: filters.status } : {};
  if (user.role === "USER") {
    where.createdById = user.id;
  }

  const [data, total] = await Promise.all([
    prisma.ticket.findMany({
      where,
      orderBy: { [sort]: order },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.ticket.count({ where }),
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

export async function getTicketById(id: string, user: UserContext) {
  const where: Prisma.TicketWhereUniqueInput = { id };
  if (user.role === "USER") {
    where.createdById = user.id;
  }
  const ticket = await prisma.ticket.findUnique({ where });
  if (!ticket) {
    throw AppError.notFound("Not found", "NOT_FOUND");
  }
  return ticket;
}

export async function updateTicketStatus(id: string, status: string) {
  return prisma.ticket.update({
    where: { id },
    data: { status: status as "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED" },
  });
}
