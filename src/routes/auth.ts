import { Router } from "express";
import { prisma } from "../prisma.js";
import { loginSchema } from "../schema.js";
import { verifyPassword, getDummyHash } from "../auth/passwords.js";
import { signAccessToken } from "../auth/tokens.js";
import { authenticate } from "../auth/middleware.js";

export const authRouter = Router();

authRouter.post("/login", async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, passwordHash: true, role: true, status: true },
  });

  const hashToCheck = user?.passwordHash ?? getDummyHash();
  const isValid = await verifyPassword(password, hashToCheck);

  if (!user || !isValid || user.status !== "ACTIVE") {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const accessToken = signAccessToken({ sub: user.id, role: user.role });
  res.json({ accessToken });
});

authRouter.get("/me", authenticate, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: { id: true, email: true, role: true, status: true, createdAt: true },
  });
  res.json(user);
});
