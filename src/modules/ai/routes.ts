// AI routes
import { Router, type Request, type Response, type NextFunction } from "express";
import rateLimit from "express-rate-limit";
import * as aiController from "./controller.js";
import { authenticate } from "../../middleware/auth.js";
import { env } from "../../config/env.js";

export const aiRouter = Router();

aiRouter.use(authenticate);

// Per-user rate limiter for /ai/ask
if (env.RATE_LIMIT_ENABLED) {
  const createUserLimiter = (windowMs: number, max: number, message: string) =>
    rateLimit({
      windowMs,
      max,
      handler: (_req: Request, res: Response) => {
        res.status(429).json({ error: message });
      },
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req: Request) => {
        // Use user ID as key (req.user is set by authenticate middleware)
        return req.user?.id ?? req.ip ?? "anonymous";
      },
    });

  aiRouter.use(
    "/ask",
    createUserLimiter(60 * 60 * 1000, env.AI_RATE_LIMIT_PER_HOUR, "Too many requests")
  );
}

aiRouter.post("/ask", aiController.ask);
aiRouter.get("/history", aiController.getHistory);