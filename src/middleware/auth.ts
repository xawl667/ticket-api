import type { Request, Response, NextFunction } from "express";
import { prisma } from "../shared/prisma.js";
import { verifyAccessToken, type AccessTokenPayload } from "../modules/auth/tokens.js";
import "../shared/types.js";

export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const token = authHeader.slice(7);
  let payload: AccessTokenPayload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, role: true, status: true },
  });

  if (!user || user.status !== "ACTIVE") {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  req.user = { id: user.id, sub: user.id, role: user.role };
  next();
}

export function requireRole(...allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  };
}
