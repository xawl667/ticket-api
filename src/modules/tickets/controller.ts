import type { Request, Response } from "express";
import {
  createTicketSchema,
  listQuerySchema,
  updateStatusSchema,
} from "../../shared/schema.js";
import * as ticketsService from "./service.js";

export async function createTicket(req: Request, res: Response) {
  const data = createTicketSchema.parse(req.body);
  const ticket = await ticketsService.createTicket(data, { id: req.user!.id, role: req.user!.role });
  res.status(201).json(ticket);
}

export async function getTickets(req: Request, res: Response) {
  const { status } = listQuerySchema.parse(req.query);
  const filters = status ? { status: status as "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED" } : {};
  const tickets = await ticketsService.getTickets(filters, { id: req.user!.id, role: req.user!.role });
  res.json(tickets);
}

export async function getTicketById(req: Request, res: Response) {
  const ticket = await ticketsService.getTicketById(req.params.id as string, { id: req.user!.id, role: req.user!.role });
  res.json(ticket);
}

export async function updateTicketStatus(req: Request, res: Response) {
  const { status } = updateStatusSchema.parse(req.body);
  const ticket = await ticketsService.updateTicketStatus(req.params.id as string, status);
  res.json(ticket);
}
