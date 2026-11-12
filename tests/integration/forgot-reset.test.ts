import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import request from 'supertest';
import { truncateTestDatabase, createTestUser, createTestUserWithRefreshToken, authHeader, getLastResetToken, clearCapturedEmails, getPrisma } from '../setup.js';

let app: any;
let prisma: any;

beforeAll(async () => {
  const [mod, prismaMod] = await Promise.all([
    import('../../src/app.js'),
    import('../../src/shared/prisma.js'),
  ]);
  app = mod.app;
  prisma = prismaMod.prisma;
});

describe('Forgot/Reset password integration', () => {
  let activeUser: Awaited<ReturnType<typeof createTestUser>>;
  let disabledUser: Awaited<ReturnType<typeof createTestUser>>;
  let activeUserWithRefresh: Awaited<ReturnType<typeof createTestUserWithRefreshToken>>;

  beforeEach(async () => {
    await truncateTestDatabase();
    clearCapturedEmails();

    activeUser = await createTestUser('USER', 'ACTIVE', { password: 'OldPass123!' });
    disabledUser = await createTestUser('USER', 'DISABLED', { password: 'OldPass123!' });
    activeUserWithRefresh = await createTestUserWithRefreshToken('USER', 'ACTIVE', { password: 'OldPass123!' });
  });

  // ========================================================================
  // POST /auth/forgot-password - anti-enumeration
  // ========================================================================
  describe('POST /auth/forgot-password', () => {
    it('returns 200 for unknown email', async () => {
      const res = await request(app)
        .post('/auth/forgot-password')
        .send({ email: 'unknown@example.com' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: 'If the account exists and is active, a reset link has been sent' });
    });

    it('returns 200 for ACTIVE user and sends email', async () => {
      const res = await request(app)
        .post('/auth/forgot-password')
        .send({ email: activeUser.email });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: 'If the account exists and is active, a reset link has been sent' });

      const token = getLastResetToken();
      console.log('[DEBUG forgot] captured token:', token);
      if (token) {
        const p = await getPrisma();
        const userToken = await p.userToken.findFirst({
          where: { userId: activeUser.id, type: 'PASSWORD_RESET' },
          orderBy: { createdAt: 'desc' },
        });
        console.log('[DEBUG forgot] UserToken in DB:', userToken ? { type: userToken.type, usedAt: userToken.usedAt, expiresAt: userToken.expiresAt, tokenHash: userToken.tokenHash.slice(0, 10) } : null);
      }
      expect(token).toBeTruthy();
    });

    it('returns 200 for DISABLED user but does NOT send email', async () => {
      const res = await request(app)
        .post('/auth/forgot-password')
        .send({ email: disabledUser.email });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: 'If the account exists and is active, a reset link has been sent' });

      // No reset email should be captured
      const token = getLastResetToken();
      expect(token).toBeFalsy();
    });

    it('invalidates previous reset tokens for same user', async () => {
      // Request reset twice
      await request(app).post('/auth/forgot-password').send({ email: activeUser.email });
      const token1 = getLastResetToken();
      console.log('[DEBUG reset invalidate] token1:', token1);
      if (token1) {
        const p = await getPrisma();
        const ut1 = await p.userToken.findFirst({
          where: { userId: activeUser.id, type: 'PASSWORD_RESET' },
          orderBy: { createdAt: 'desc' },
        });
        console.log('[DEBUG reset invalidate] UserToken after 1st:', ut1 ? { usedAt: ut1.usedAt, expiresAt: ut1.expiresAt } : null);
      }
      clearCapturedEmails();

      await request(app).post('/auth/forgot-password').send({ email: activeUser.email });
      const token2 = getLastResetToken();
      console.log('[DEBUG reset invalidate] token2:', token2);
      if (token2) {
        const p = await getPrisma();
        const ut2 = await p.userToken.findFirst({
          where: { userId: activeUser.id, type: 'PASSWORD_RESET' },
          orderBy: { createdAt: 'desc' },
        });
        console.log('[DEBUG reset invalidate] UserToken after 2nd:', ut2 ? { usedAt: ut2.usedAt, expiresAt: ut2.expiresAt } : null);
      }

      expect(token1).not.toBe(token2);

      // First token should be invalidated
      const res1 = await request(app)
        .post('/auth/reset-password')
        .send({ token: token1!, password: 'NewPass123!!' });
      expect(res1.status).toBe(400);

      // Second token should work
      const res2 = await request(app)
        .post('/auth/reset-password')
        .send({ token: token2!, password: 'NewPass123!!' });
      expect(res2.status).toBe(204);
    });
  });

  // ========================================================================
  // POST /auth/reset-password
  // ========================================================================
  describe('POST /auth/reset-password', () => {
    it('resets password with valid token', async () => {
      await request(app).post('/auth/forgot-password').send({ email: activeUser.email });
      const token = getLastResetToken();
      console.log('[DEBUG reset valid] token:', token);
      if (token) {
        const p = await getPrisma();
        const ut = await p.userToken.findFirst({
          where: { userId: activeUser.id, type: 'PASSWORD_RESET' },
          orderBy: { createdAt: 'desc' },
        });
        console.log('[DEBUG reset valid] UserToken before reset:', ut ? { usedAt: ut.usedAt, expiresAt: ut.expiresAt } : null);
      }

      const res = await request(app)
        .post('/auth/reset-password')
        .send({ token: token!, password: 'NewPass123!!' });

      expect(res.status).toBe(204);

      // Old password no longer works
      const oldLogin = await request(app)
        .post('/auth/login')
        .send({ email: activeUser.email, password: 'OldPass123!' });
      expect(oldLogin.status).toBe(401);

      // New password works
      const newLogin = await request(app)
        .post('/auth/login')
        .send({ email: activeUser.email, password: 'NewPass123!!' });
      expect(newLogin.status).toBe(200);
    });

    it('returns 400 for reused token', async () => {
      await request(app).post('/auth/forgot-password').send({ email: activeUser.email });
      const token = getLastResetToken();

      await request(app).post('/auth/reset-password').send({ token: token!, password: 'NewPass123!!' });

      const res = await request(app)
        .post('/auth/reset-password')
        .send({ token: token!, password: 'AnotherPass123!!' });
      expect(res.status).toBe(400);
    });

    it('revokes all refresh tokens after reset', async () => {
      // Login to get fresh refresh token
      const login = await request(app)
        .post('/auth/login')
        .send({ email: activeUser.email, password: 'OldPass123!' });
      const refreshToken = login.body.refreshToken;

      await request(app).post('/auth/forgot-password').send({ email: activeUser.email });
      const token = getLastResetToken();

      await request(app).post('/auth/reset-password').send({ token: token!, password: 'NewPass123!!' });

      // Refresh token should be revoked
      const res = await request(app)
        .post('/auth/refresh')
        .send({ refreshToken });
      expect(res.status).toBe(401);
    });

    it('returns 400 for short password', async () => {
      const res = await request(app)
        .post('/auth/reset-password')
        .send({ token: 'abc', password: 'short' });
      expect(res.status).toBe(400);
    });

    it('returns 400 for password > 72 chars', async () => {
      const res = await request(app)
        .post('/auth/reset-password')
        .send({ token: 'abc', password: 'x'.repeat(73) });
      expect(res.status).toBe(400);
    });
  });
});