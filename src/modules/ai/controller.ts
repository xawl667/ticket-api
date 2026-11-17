// AI controller
import type { Request, Response } from "express";
import { askSchema, historyQuerySchema } from "../../shared/schema.js";
import * as aiService from "./service.js";

export async function ask(req: Request, res: Response) {
  const { question } = askSchema.parse(req.body);
  const userId = req.user!.id;

  const result = await aiService.askQuestion(userId, question);

  if (result.status === "REFUSED") {
    return res.status(422).json({ error: "Question outside the IT scope" });
  }

  if (result.status === "FAILED") {
    return res.status(503).json({ error: "AI service unavailable" });
  }

  // ANSWERED
  return res.status(200).json({
    id: result.id,
    answer: result.answer,
    createdAt: result.createdAt,
  });
}

export async function getHistory(req: Request, res: Response) {
  const { userId, page, limit } = historyQuerySchema.parse(req.query);
  const requesterId = req.user!.id;
  const requesterRole = req.user!.role;

  const result = await aiService.getHistory(requesterId, requesterRole, {
    userId: userId as string | undefined,
    page,
    limit,
  });

  res.json(result);
}