import { Router } from "express";
import { prisma } from "../prisma.js";
import {
  createTicketSchema,
  listQuerySchema,
  updateStatusSchema,
} from "../schema.js";

export const ticketsRouter = Router();

// Créer un ticket
ticketsRouter.post("/", async (req, res) => {
  const data = createTicketSchema.parse(req.body);
  const ticket = await prisma.ticket.create({ data });
  res.status(201).json(ticket);
});

// Lister les tickets (filtre optionnel ?status=OPEN)
ticketsRouter.get("/", async (req, res) => {
  const { status } = listQuerySchema.parse(req.query);
  const tickets = await prisma.ticket.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "desc" },
  });
  res.json(tickets);
});

// Récupérer un ticket par ID
ticketsRouter.get("/:id", async (req, res) => {
  const ticket = await prisma.ticket.findUnique({
    where: { id: req.params.id },
  });
  if (!ticket) {
    return res.status(404).json({ error: "Ticket not found" });
  }
  res.json(ticket);
});

// Modifier le statut
ticketsRouter.patch("/:id/status", async (req, res) => {
  const { status } = updateStatusSchema.parse(req.body);
  const ticket = await prisma.ticket.update({
    where: { id: req.params.id },
    data: { status },
  });
  res.json(ticket);
});

