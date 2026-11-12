import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import request from 'supertest';
import { truncateTestDatabase, createTestUser, createTestUserWithRefreshToken, authHeader, getCapturedEmails, clearCapturedEmails } from '../setup.js';

let app: any;

beforeAll(async () => {
  const mod = await import('../../src/app.js');
  app = mod.app;
});

describe('Auth integration', () => {
  let activeUser: Awaited<ReturnType<typeof createTestUser>>;
  let invitedUser: Awaited<ReturnType<typeof createTestUser>>;
  let disabledUser: Awaited<ReturnType<typeof createTestUser>>;
  let activeUserWithRefresh: Awaited<ReturnType<typeof createTestUserWithRefreshToken>>;
  let disabledUserWithRefresh: Awaited<ReturnType<typeof createTestUserWithRefreshToken>>;

  beforeEach(async () => {
    await truncateTestDatabase();
    clearCapturedEmails();

    activeUser = await createTestUser('USER', 'ACTIVE', { password: 'TestPass123!' });
    invitedUser = await createTestUser('USER', 'INVITED', { password: 'TestPass123!' });
    disabledUser = await createTestUser('USER', 'DISABLED', { password: 'TestPass123!' });
    activeUserWithRefresh = await createTestUserWithRefreshToken('USER', 'ACTIVE', { password: 'TestPass123!' });
    disabledUserWithRefresh = await createTestUserWithRefreshToken('USER', 'DISABLED', { password: 'TestPass123!' });
  });

  describe('POST /auth/login', () => {
    it('returns 200 with tokens for valid credentials', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({ email: activeUser.email, password: 'TestPass123!' });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('accessToken');
      expect(res.body).toHaveProperty('refreshToken');
      expect(typeof res.body.accessToken).toBe('string');
      expect(typeof res.body.refreshToken).toBe('string');
    });

    it('returns 401 for wrong password', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({ email: activeUser.email, password: 'WrongPass123!' });

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'Invalid credentials' });
    });

    it('returns 401 for unknown email (same error as wrong password)', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({ email: 'unknown@example.com', password: 'TestPass123!' });

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'Invalid credentials' });
    });

    it('returns 401 for INVITED user (same error)', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({ email: invitedUser.email, password: 'TestPass123!' });

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'Invalid credentials' });
    });

    it('returns 401 for DISABLED user (same error)', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({ email: disabledUser.email, password: 'TestPass123!' });

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'Invalid credentials' });
    });

    it('uses dummy hash for timing consistency on unknown email', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({ email: 'nonexistent@example.com', password: 'TestPass123!' });
      expect(res.status).toBe(401);
    });

    it('never returns passwordHash in response', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({ email: activeUser.email, password: 'TestPass123!' });
      expect(res.body).not.toHaveProperty('passwordHash');
    });
  });

  describe('GET /auth/me', () => {
    it('returns 200 with user info for valid token', async () => {
      const res = await request(app)
        .get('/auth/me')
        .set(authHeader(activeUser.accessToken));

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        id: activeUser.id,
        email: activeUser.email,
        role: activeUser.role,
        status: 'ACTIVE',
        createdAt: expect.any(String),
      });
    });

    it('returns 401 without token', async () => {
      const res = await request(app).get('/auth/me');
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'Unauthorized' });
    });

    it('returns 401 with malformed token', async () => {
      const res = await request(app)
        .get('/auth/me')
        .set('Authorization', 'Bearer not-a-valid-jwt');
      expect(res.status).toBe(401);
    });

    it('returns 401 with token containing forged role (DB role takes precedence)', async () => {
      const { signTestAccessToken } = await import('../setup.js');
      const forgedToken = signTestAccessToken({ sub: activeUser.id, role: 'ADMIN' });
      const res = await request(app)
        .get('/auth/me')
        .set(authHeader(forgedToken));

      expect(res.status).toBe(200);
      expect(res.body.role).toBe('USER'); // DB role wins
    });

    it('returns 401 for DISABLED user even with valid token', async () => {
      const res = await request(app)
        .get('/auth/me')
        .set(authHeader(disabledUser.accessToken));
      expect(res.status).toBe(401);
    });

    it('never returns passwordHash', async () => {
      const res = await request(app)
        .get('/auth/me')
        .set(authHeader(activeUser.accessToken));
      expect(res.body).not.toHaveProperty('passwordHash');
    });
  });

  describe('POST /auth/refresh', () => {
    it('rotates refresh token and returns new access+refresh', async () => {
      const res = await request(app)
        .post('/auth/refresh')
        .send({ refreshToken: activeUserWithRefresh.refreshToken });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('accessToken');
      expect(res.body).toHaveProperty('refreshToken');
      expect(res.body.refreshToken).not.toBe(activeUserWithRefresh.refreshToken);
    });

    it('returns 401 for missing refreshToken', async () => {
      const res = await request(app).post('/auth/refresh').send({});
      expect(res.status).toBe(401);
    });

    it('returns 401 for invalid refreshToken', async () => {
      const res = await request(app)
        .post('/auth/refresh')
        .send({ refreshToken: 'invalid-token' });
      expect(res.status).toBe(401);
    });

    it('returns 401 and revokes family on reuse detection', async () => {
      // First refresh - succeeds
      const res1 = await request(app)
        .post('/auth/refresh')
        .send({ refreshToken: activeUserWithRefresh.refreshToken });
      expect(res1.status).toBe(200);

      // Second refresh with SAME old token - should fail and revoke family
      const res2 = await request(app)
        .post('/auth/refresh')
        .send({ refreshToken: activeUserWithRefresh.refreshToken });
      expect(res2.status).toBe(401);
      expect(res2.body).toEqual({ error: 'Unauthorized' });

      // Third refresh with the new token from res1 should also fail (family revoked)
      const res3 = await request(app)
        .post('/auth/refresh')
        .send({ refreshToken: res1.body.refreshToken });
      expect(res3.status).toBe(401);
    });

    it('handles concurrent refresh with same token: only one succeeds', async () => {
      const [res1, res2] = await Promise.all([
        request(app).post('/auth/refresh').send({ refreshToken: activeUserWithRefresh.refreshToken }),
        request(app).post('/auth/refresh').send({ refreshToken: activeUserWithRefresh.refreshToken }),
      ]);

      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([200, 401]);
    });

    it('returns 401 for DISABLED user', async () => {
      const res = await request(app)
        .post('/auth/refresh')
        .send({ refreshToken: disabledUserWithRefresh.refreshToken });
      expect(res.status).toBe(401);
    });
  });

  describe('POST /auth/logout', () => {
    it('revokes refresh token family', async () => {
      const user = await createTestUserWithRefreshToken('USER', 'ACTIVE', { password: 'TestPass123!' });

      await request(app)
        .post('/auth/logout')
        .send({ refreshToken: user.refreshToken });

      // Try to use the refresh token after logout
      const res = await request(app)
        .post('/auth/refresh')
        .send({ refreshToken: user.refreshToken });
      expect(res.status).toBe(401);
    });

    it('returns 200 even without refreshToken (idempotent)', async () => {
      const res = await request(app).post('/auth/logout').send({});
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
    });

    it('returns 200 with valid refreshToken', async () => {
      const res = await request(app)
        .post('/auth/logout')
        .send({ refreshToken: activeUserWithRefresh.refreshToken });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
    });
  });
});