import type { AccessTokenPayload } from "../modules/auth/tokens.js";

declare global {
  namespace Express {
    interface Request {
      user?: AccessTokenPayload & { id: string };
    }
  }
}

export {};
