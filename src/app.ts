import express from "express";
import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { ticketsRouter } from "./routes/tickets.js";

export const app = express();

app.use(express.json());
app.use("/tickets", ticketsRouter);

// Route inconnue
app.use((_req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// Gestion d'erreurs globale
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: "Validation failed", details: err.issues });
  }
  if (err instanceof SyntaxError) {
    return res.status(400).json({ error: "Invalid JSON" });
  }
  if (typeof err === "object" && err !== null && "code" in err && err.code === "P2025") {
    return res.status(404).json({ error: "Ticket not found" });
  }
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});