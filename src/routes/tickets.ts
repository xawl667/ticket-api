import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import {
  createTicketSchema,
  listQuerySchema,
  updateStatusSchema,
} from "../schema.js";
import { authenticate } from "../auth/middleware.js";
import { requireRole } from "../auth/middleware.js";

export const ticketsRouter = Router();

ticketsRouter.use(authenticate);

// Créer un ticket - tous les rôles authentifiés
ticketsRouter.post("/", async (req, res) => {
  const data = createTicketSchema.parse(req.body);
  const ticket = await prisma.ticket.create({
    data: { ...data, createdById: req.user!.id },
  });
  res.status(201).json(ticket);
});

// Lister les tickets - USER ne voit que les siens
ticketsRouter.get("/", async (req, res) => {
  const { status } = listQuerySchema.parse(req.query);
  const where: Prisma.TicketWhereInput = status ? { status } : {};
  if (req.user!.role === "USER") {
    where.createdById = req.user!.id;
  }
  const tickets = await prisma.ticket.findMany({
    where,
    orderBy: { createdAt: "desc" },
  });
  res.json(tickets);
});

// Récupérer un ticket par ID - USER seulement le sien (404 sinon)
ticketsRouter.get("/:id", async (req, res) => {
  const id = req.params.id as string;
  const where: Prisma.TicketWhereUniqueInput = { id };
  if (req.user!.role === "USER") {
    where.createdById = req.user!.id;
  }
  const ticket = await prisma.ticket.findUnique({ where });
  if (!ticket) {
    return res.status(404).json({ error: "Not found" });
  }
  res.json(ticket);
});

// Modifier le statut - SUPER_ADMIN, ADMIN, AGENT uniquement
ticketsRouter.patch(
  "/:id/status",
  requireRole("SUPER_ADMIN", "ADMIN", "AGENT"),
  async (req, res) => {
    const { status } = updateStatusSchema.parse(req.body);
    const id = req.params.id as string;
    const ticket = await prisma.ticket.update({
      where: { id },
      data: { status },
    });
    res.json(ticket);
  }
);
