import { prisma } from "../../shared/prisma.js";
import { Prisma } from "@prisma/client";

export interface CreateTicketData {
  title: string;
  description: string;
}

export interface UpdateStatusData {
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
}

export interface TicketFilters {
  status?: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
}

export interface UserContext {
  id: string;
  role: string;
}

export async function createTicket(data: CreateTicketData, user: UserContext) {
  return prisma.ticket.create({
    data: { ...data, createdById: user.id },
  });
}

export async function getTickets(filters: TicketFilters, user: UserContext) {
  const where: Prisma.TicketWhereInput = filters.status ? { status: filters.status } : {};
  if (user.role === "USER") {
    where.createdById = user.id;
  }
  return prisma.ticket.findMany({
    where,
    orderBy: { createdAt: "desc" },
  });
}

export async function getTicketById(id: string, user: UserContext) {
  const where: Prisma.TicketWhereUniqueInput = { id };
  if (user.role === "USER") {
    where.createdById = user.id;
  }
  const ticket = await prisma.ticket.findUnique({ where });
  if (!ticket) {
    throw new Error("Not found");
  }
  return ticket;
}

export async function updateTicketStatus(id: string, status: string) {
  return prisma.ticket.update({
    where: { id },
    data: { status: status as "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED" },
  });
}
