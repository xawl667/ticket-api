import express from "express";
import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { authRouter } from "./modules/auth/routes.js";
import { usersRouter } from "./modules/users/routes.js";
import { ticketsRouter } from "./modules/tickets/routes.js";
import { auditRouter } from "./modules/audit/routes.js";
import { env } from "./config/env.js";
import { isAppError, AppError } from "./shared/errors.js";
import { setupSwagger } from "./openapi.js";

export const app = express();

app.disable("x-powered-by");

// Helmet avec CSP assouplie pour /docs si ENABLE_DOCS=true
const helmetConfig = env.ENABLE_DOCS
  ? {
      contentSecurityPolicy: {
        directives: {
          ...helmet.contentSecurityPolicy.getDefaultDirectives(),
          "script-src": ["'self'", "'unsafe-inline'"],
          "style-src": ["'self'", "'unsafe-inline'"],
          "img-src": ["'self'", "data:", "https:"],
        },
      },
    }
  : {};

app.use(helmet(helmetConfig));

// Trust proxy pour rate limiting derrière reverse proxy (nginx, etc.)
// En dev: trust proxy = false (désactivé par défaut), rate limit basé sur IP directe
// En prod derrière proxy: définir TRUST_PROXY=true dans .env
app.set("trust proxy", env.NODE_ENV === "production");

app.use(express.json({ limit: "10kb" }));

// 413 handler for body too large (must be after json parser)
app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof SyntaxError && "status" in err && err.status === 413) {
    return res.status(413).json({ error: "Payload too large" });
  }
  if (err && typeof err === "object" && "type" in err && err.type === "entity.too.large") {
    return res.status(413).json({ error: "Payload too large" });
  }
  next(err);
});

// Rate limiting configurable
if (env.RATE_LIMIT_ENABLED) {
  const createLimiter = (windowMs: number, max: number, message: string) =>
    rateLimit({
      windowMs,
      max,
      handler: (_req, res) => {
        res.status(429).json({ error: message });
      },
      standardHeaders: true,
      legacyHeaders: false,
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
app.use("/audit-logs", auditRouter);

// Swagger / OpenAPI (désactivé en prod sauf si ENABLE_DOCS=true)
setupSwagger(app, env.ENABLE_DOCS);

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
