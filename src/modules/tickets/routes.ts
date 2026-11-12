import { Router } from "express";
import * as ticketsController from "./controller.js";
import { authenticate } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/auth.js";

export const ticketsRouter = Router();

ticketsRouter.use(authenticate);

ticketsRouter.post("/", ticketsController.createTicket);
ticketsRouter.get("/", ticketsController.getTickets);
ticketsRouter.get("/:id", ticketsController.getTicketById);
ticketsRouter.patch("/:id/status", requireRole("SUPER_ADMIN", "ADMIN", "AGENT"), ticketsController.updateTicketStatus);
