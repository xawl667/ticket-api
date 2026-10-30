import jwt from "jsonwebtoken";
import { createHash, randomBytes } from "crypto";
import { env } from "../env.js";

const ACCESS_TTL = "15m";
const REFRESH_TTL_DAYS = 7;

export interface AccessTokenPayload {
  sub: string;
  role: string;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: ACCESS_TTL,
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.JWT_SECRET, {
    algorithms: ["HS256"],
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
  }) as AccessTokenPayload;
}

export function generateRefreshToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function getRefreshTokenExpiry(): Date {
  return new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
}
