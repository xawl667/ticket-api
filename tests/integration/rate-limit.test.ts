import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import request from 'supertest';
import { truncateTestDatabase, createTestUser, createTestUserWithRefreshToken, authHeader, clearCapturedEmails } from '../setup.js';

let app: any;

beforeAll(async () => {
  // Set RATE_LIMIT_ENABLED=true BEFORE importing app
  vi.stubEnv('RATE_LIMIT_ENABLED', 'true');
  vi.resetModules();
  const mod = await import('../../src/app.js');
  app = mod.app;
});

describe('Rate limiting (RATE_LIMIT_ENABLED=true)', () => {
  let user: Awaited<ReturnType<typeof createTestUser>>;
  let userWithRefresh: Awaited<ReturnType<typeof createTestUserWithRefreshToken>>;

  beforeEach(async () => {
    await truncateTestDatabase();
    clearCapturedEmails();

    user = await createTestUser('USER', 'ACTIVE', { password: 'TestPass123!' });
    userWithRefresh = await createTestUserWithRefreshToken('USER', 'ACTIVE', { password: 'TestPass123!' });
  });

  // Note: Rate limits are per IP. Since all requests come from same test process,
  // they share the same IP. We need to test each endpoint's limit independently.

  describe('POST /auth/login - 10 req / 15 min', () => {
    it('allows up to 10 requests', async () => {
      for (let i = 0; i < 10; i++) {
        const res = await request(app)
          .post('/auth/login')
          .send({ email: `user${i}@example.com`, password: 'wrong' });
        // All should be 401 (wrong credentials), not 429
        expect(res.status).toBe(401);
      }
    });

    it('returns 429 on 11th request', async () => {
      for (let i = 0; i < 10; i++) {
        await request(app).post('/auth/login').send({ email: `user${i}@example.com`, password: 'wrong' });
      }
      const res = await request(app)
        .post('/auth/login')
        .send({ email: 'extra@example.com', password: 'wrong' });
      expect(res.status).toBe(429);
    });

    it('429 response has no internal details', async () => {
      for (let i = 0; i < 11; i++) {
        await request(app).post('/auth/login').send({ email: `u${i}@x.com`, password: 'x' });
      }
      const res = await request(app).post('/auth/login').send({ email: 'x@y.z', password: 'x' });
      expect(res.status).toBe(429);
      expect(res.body).not.toHaveProperty('stack');
      expect(res.body).not.toHaveProperty('details');
    });
  });

  describe('POST /auth/forgot-password - 10 req / 15 min', () => {
    it('allows up to 10 requests', async () => {
      for (let i = 0; i < 10; i++) {
        const res = await request(app)
          .post('/auth/forgot-password')
          .send({ email: `user${i}@example.com` });
        expect(res.status).toBe(200);
      }
    });

    it('returns 429 on 11th request', async () => {
      for (let i = 0; i < 10; i++) {
        await request(app).post('/auth/forgot-password').send({ email: `u${i}@x.com` });
      }
      const res = await request(app).post('/auth/forgot-password').send({ email: 'extra@x.com' });
      expect(res.status).toBe(429);
    });

    it('429 response has no internal details', async () => {
      for (let i = 0; i < 11; i++) {
        await request(app).post('/auth/forgot-password').send({ email: `u${i}@x.com` });
      }
      const res = await request(app).post('/auth/forgot-password').send({ email: 'x@y.z' });
      expect(res.status).toBe(429);
      expect(res.body).not.toHaveProperty('stack');
    });
  });

  describe('POST /auth/accept-invitation - 10 req / 15 min', () => {
    it('allows up to 10 requests', async () => {
      for (let i = 0; i < 10; i++) {
        const res = await request(app)
          .post('/auth/accept-invitation')
          .send({ token: `token-${i}`, password: 'ValidPass123!' });
        expect(res.status).toBe(400); // Invalid token, but not rate limited
      }
    });

    it('returns 429 on 11th request', async () => {
      for (let i = 0; i < 10; i++) {
        await request(app).post('/auth/accept-invitation').send({ token: `t${i}`, password: 'ValidPass123!' });
      }
      const res = await request(app).post('/auth/accept-invitation').send({ token: 'extra', password: 'ValidPass123!' });
      expect(res.status).toBe(429);
    });
  });

  describe('POST /auth/reset-password - 10 req / 15 min', () => {
    it('allows up to 10 requests', async () => {
      for (let i = 0; i < 10; i++) {
        const res = await request(app)
          .post('/auth/reset-password')
          .send({ token: `token-${i}`, password: 'ValidPass123!' });
        expect(res.status).toBe(400);
      }
    });

    it('returns 429 on 11th request', async () => {
      for (let i = 0; i < 10; i++) {
        await request(app).post('/auth/reset-password').send({ token: `t${i}`, password: 'ValidPass123!' });
      }
      const res = await request(app).post('/auth/reset-password').send({ token: 'extra', password: 'ValidPass123!' });
      expect(res.status).toBe(429);
    });
  });

  describe('POST /auth/refresh - 30 req / 15 min', () => {
    it('allows up to 30 requests', async () => {
      for (let i = 0; i < 30; i++) {
        const res = await request(app)
          .post('/auth/refresh')
          .send({ refreshToken: `invalid-${i}` });
        expect(res.status).toBe(401); // Invalid token, not rate limited
      }
    });

    it('returns 429 on 31st request', async () => {
      for (let i = 0; i < 30; i++) {
        await request(app).post('/auth/refresh').send({ refreshToken: `invalid-${i}` });
      }
      const res = await request(app).post('/auth/refresh').send({ refreshToken: 'extra' });
      expect(res.status).toBe(429);
    });
  });
});