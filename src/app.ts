import express from "express";
import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { authRouter } from "./modules/auth/routes.js";
import { usersRouter } from "./modules/users/routes.js";
import { ticketsRouter } from "./modules/tickets/routes.js";
import { env } from "./config/env.js";
import { isAppError, AppError } from "./shared/errors.js";

export const app = express();

app.disable("x-powered-by");
app.use(helmet());

// Trust proxy pour rate limiting derri?re reverse proxy (nginx, etc.)
// En dev: trust proxy = false (d?sactiv? par d?faut), rate limit bas? sur IP directe
// En prod derri?re proxy: d?finir TRUST_PROXY=true dans .env
app.set("trust proxy", env.NODE_ENV === "production");

app.use(express.json({ limit: "10kb" }));

// Rate limiting configurable
if (env.RATE_LIMIT_ENABLED) {
  const createLimiter = (windowMs: number, max: number, message: string) =>
    rateLimit({
      windowMs,
      max,
      message: { error: message },
      standardHeaders: true,
      legacyHeaders: false,
      // keyGenerator par d?faut = IP (respecte trust proxy)
    });

  // /auth/login : 10 req / 15 min
  app.use("/auth/login", createLimiter(15 * 60 * 1000, 10, "Too many login attempts"));

  // /auth/forgot-password : 10 req / 15 min
  app.use("/auth/forgot-password", createLimiter(15 * 60 * 1000, 10, "Too many requests"));

  // /auth/accept-invitation : 10 req / 15 min
  app.use("/auth/accept-invitation", createLimiter(15 * 60 * 1000, 10, "Too many requests"));

  // /auth/reset-password : 10 req / 15 min
  app.use("/auth/reset-password", createLimiter(15 * 60 * 1000, 10, "Too many requests"));

  // /auth/refresh : 30 req / 15 min
  app.use("/auth/refresh", createLimiter(15 * 60 * 1000, 30, "Too many requests"));
}

app.use("/auth", authRouter);
app.use("/users", usersRouter);
app.use("/tickets", ticketsRouter);

// Route inconnue
app.use((_req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// Gestion d'erreurs globale
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (isAppError(err)) {
    return res.status(err.statusCode).json({ error: err.message });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({ error: "Validation failed", details: err.issues });
  }
  if (err instanceof SyntaxError) {
    return res.status(400).json({ error: "Invalid JSON" });
  }
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = (err as { code: string }).code;
    if (code === "P2025") {
      return res.status(404).json({ error: "Not found" });
    }
    if (code === "P2002") {
      return res.status(409).json({ error: "Conflict" });
    }
  }
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});
