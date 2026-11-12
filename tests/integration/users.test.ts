import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import request from 'supertest';
import { truncateTestDatabase, createTestUser, authHeader, getLastInvitationToken, clearCapturedEmails, getPrisma } from '../setup.js';

let app: any;
let prisma: any;

beforeAll(async () => {
  const [appMod, prismaMod] = await Promise.all([
    import('../../src/app.js'),
    import('../../src/shared/prisma.js'),
  ]);
  app = appMod.app;
  prisma = prismaMod.prisma;
});

describe('Users integration', () => {
  let superAdmin: Awaited<ReturnType<typeof createTestUser>>;
  let admin: Awaited<ReturnType<typeof createTestUser>>;
  let agent: Awaited<ReturnType<typeof createTestUser>>;
  let user: Awaited<ReturnType<typeof createTestUser>>;

  beforeEach(async () => {
    await truncateTestDatabase();
    clearCapturedEmails();

    superAdmin = await createTestUser('SUPER_ADMIN', 'ACTIVE');
    admin = await createTestUser('ADMIN', 'ACTIVE');
    agent = await createTestUser('AGENT', 'ACTIVE');
    user = await createTestUser('USER', 'ACTIVE');
  });

  // ========================================================================
  // POST /users - SUPER_ADMIN only
  // ========================================================================
  describe('POST /users', () => {
    it('SUPER_ADMIN can create user with default USER role', async () => {
      const res = await request(app)
        .post('/users')
        .set(authHeader(superAdmin.accessToken))
        .send({ email: 'newuser@example.com' });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        id: expect.any(String),
        email: 'newuser@example.com',
        role: 'USER',
        status: 'INVITED',
        createdAt: expect.any(String),
      });

      // Verify invitation email was captured
      const token = getLastInvitationToken();
      expect(token).toBeTruthy();
    });

    it('SUPER_ADMIN can create user with explicit role', async () => {
      for (const role of ['ADMIN', 'AGENT', 'USER'] as const) {
        const res = await request(app)
          .post('/users')
          .set(authHeader(superAdmin.accessToken))
          .send({ email: `new-${role.toLowerCase()}@example.com`, role });

        expect(res.status).toBe(201);
        expect(res.body.role).toBe(role);
        expect(res.body.status).toBe('INVITED');
      }
    });

    it('rejects SUPER_ADMIN role creation', async () => {
      const res = await request(app)
        .post('/users')
        .set(authHeader(superAdmin.accessToken))
        .send({ email: 'super@example.com', role: 'SUPER_ADMIN' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
    });

    it('returns 409 for duplicate email', async () => {
      await request(app)
        .post('/users')
        .set(authHeader(superAdmin.accessToken))
        .send({ email: 'dup@example.com' });

      const res = await request(app)
        .post('/users')
        .set(authHeader(superAdmin.accessToken))
        .send({ email: 'dup@example.com' });

      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: 'Conflict' });
    });

    it('returns 400 for extra fields (Zod .strict)', async () => {
      const res = await request(app)
        .post('/users')
        .set(authHeader(superAdmin.accessToken))
        .send({ email: 'test@example.com', extra: 'field' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
    });

    it('returns 403 for ADMIN', async () => {
      const res = await request(app)
        .post('/users')
        .set(authHeader(admin.accessToken))
        .send({ email: 'test@example.com' });
      expect(res.status).toBe(403);
    });

    it('returns 403 for AGENT', async () => {
      const res = await request(app)
        .post('/users')
        .set(authHeader(agent.accessToken))
        .send({ email: 'test@example.com' });
      expect(res.status).toBe(403);
    });

    it('returns 403 for USER', async () => {
      const res = await request(app)
        .post('/users')
        .set(authHeader(user.accessToken))
        .send({ email: 'test@example.com' });
      expect(res.status).toBe(403);
    });

    it('returns 401 without auth', async () => {
      const res = await request(app).post('/users').send({ email: 'test@example.com' });
      expect(res.status).toBe(401);
    });
  });

  // ========================================================================
  // GET /users - SUPER_ADMIN, ADMIN
  // ========================================================================
  describe('GET /users', () => {
    it('SUPER_ADMIN sees all users without passwordHash', async () => {
      const res = await request(app)
        .get('/users')
        .set(authHeader(superAdmin.accessToken));

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      for (const u of res.body) {
        expect(u).not.toHaveProperty('passwordHash');
        expect(u).toHaveProperty('id');
        expect(u).toHaveProperty('email');
        expect(u).toHaveProperty('role');
        expect(u).toHaveProperty('status');
        expect(u).toHaveProperty('createdAt');
      }
    });

    it('ADMIN sees all users', async () => {
      const res = await request(app)
        .get('/users')
        .set(authHeader(admin.accessToken));
      expect(res.status).toBe(200);
    });

    it('returns 403 for AGENT', async () => {
      const res = await request(app)
        .get('/users')
        .set(authHeader(agent.accessToken));
      expect(res.status).toBe(403);
    });

    it('returns 403 for USER', async () => {
      const res = await request(app)
        .get('/users')
        .set(authHeader(user.accessToken));
      expect(res.status).toBe(403);
    });
  });

  // ========================================================================
  // PATCH /users/:id/disable - SUPER_ADMIN only
  // ========================================================================
  describe('PATCH /users/:id/disable', () => {
    it('SUPER_ADMIN can disable another user', async () => {
      const target = await createTestUser('USER', 'ACTIVE');
      const res = await request(app)
        .patch(`/users/${target.id}/disable`)
        .set(authHeader(superAdmin.accessToken));

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('DISABLED');
      expect(res.body.id).toBe(target.id);

      // Verify refresh tokens revoked
      const tokens = await prisma.refreshToken.findMany({ where: { userId: target.id } });
      expect(tokens.every(t => t.revokedAt)).toBe(true);
    });

    it('returns 400 when disabling self', async () => {
      const res = await request(app)
        .patch(`/users/${superAdmin.id}/disable`)
        .set(authHeader(superAdmin.accessToken));

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Cannot disable yourself');
    });

    it('returns 404 for unknown user', async () => {
      const res = await request(app)
        .patch('/users/00000000-0000-0000-0000-000000000000/disable')
        .set(authHeader(superAdmin.accessToken));
      expect(res.status).toBe(404);
    });

    it('returns 403 for ADMIN', async () => {
      const target = await createTestUser('USER', 'ACTIVE');
      const res = await request(app)
        .patch(`/users/${target.id}/disable`)
        .set(authHeader(admin.accessToken));
      expect(res.status).toBe(403);
    });

    it('disabled user cannot login', async () => {
      const target = await createTestUser('USER', 'ACTIVE', { password: 'TestPass123!' });
      await request(app)
        .patch(`/users/${target.id}/disable`)
        .set(authHeader(superAdmin.accessToken));

      const res = await request(app)
        .post('/auth/login')
        .send({ email: target.email, password: 'TestPass123!' });
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'Invalid credentials' });
    });
  });

  // ========================================================================
  // PATCH /users/:id/enable - SUPER_ADMIN only
  // ========================================================================
  describe('PATCH /users/:id/enable', () => {
    it('SUPER_ADMIN can enable DISABLED user -> ACTIVE (has password)', async () => {
      const target = await createTestUser('USER', 'DISABLED', { password: 'TestPass123!' });
      const res = await request(app)
        .patch(`/users/${target.id}/enable`)
        .set(authHeader(superAdmin.accessToken));

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ACTIVE');
    });

    it('SUPER_ADMIN can enable DISABLED user -> INVITED (no password)', async () => {
      const target = await prisma.user.create({
        data: {
          email: 'nopass@example.com',
          role: 'USER',
          status: 'DISABLED',
        },
      });

      const res = await request(app)
        .patch(`/users/${target.id}/enable`)
        .set(authHeader(superAdmin.accessToken));

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('INVITED');
    });

    it('returns 404 for unknown user', async () => {
      const res = await request(app)
        .patch('/users/00000000-0000-0000-0000-000000000000/enable')
        .set(authHeader(superAdmin.accessToken));
      expect(res.status).toBe(404);
    });

    it('returns 400 for non-DISABLED user', async () => {
      const res = await request(app)
        .patch(`/users/${user.id}/enable`)
        .set(authHeader(superAdmin.accessToken));
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('User is not disabled');
    });

    it('returns 403 for ADMIN', async () => {
      const target = await createTestUser('USER', 'DISABLED');
      const res = await request(app)
        .patch(`/users/${target.id}/enable`)
        .set(authHeader(admin.accessToken));
      expect(res.status).toBe(403);
    });

    it('enabled user can login again', async () => {
      const target = await createTestUser('USER', 'DISABLED', { password: 'TestPass123!' });
      await request(app)
        .patch(`/users/${target.id}/enable`)
        .set(authHeader(superAdmin.accessToken));

      const res = await request(app)
        .post('/auth/login')
        .send({ email: target.email, password: 'TestPass123!' });
      expect(res.status).toBe(200);
    });
  });

  // ========================================================================
  // POST /auth/accept-invitation
  // ========================================================================
  describe('POST /auth/accept-invitation', () => {
    it('accepts valid invitation token', async () => {
      const res = await request(app)
        .post('/users')
        .set(authHeader(superAdmin.accessToken))
        .send({ email: 'invite@example.com', role: 'USER' });

      expect(res.status).toBe(201);
      const token = getLastInvitationToken();
      console.log('[DEBUG invite] captured token:', token);
      console.log('[DEBUG invite] token length:', token?.length);
      if (token) {
        const p = await getPrisma();
        const ut = await p.userToken.findFirst({
          where: { type: 'INVITATION' },
          orderBy: { createdAt: 'desc' },
        });
        console.log('[DEBUG invite] UserToken in DB:', ut ? { type: ut.type, usedAt: ut.usedAt, expiresAt: ut.expiresAt, tokenHash: ut.tokenHash } : null);
        // Verify hash matches
        const { hashToken } = await import('../setup.js');
        const computedHash = hashToken(token);
        console.log('[DEBUG invite] computed hash:', computedHash);
        console.log('[DEBUG invite] hashes match:', computedHash === ut?.tokenHash);
      }
      expect(token).toBeTruthy();

      const acceptRes = await request(app)
        .post('/auth/accept-invitation')
        .send({ token: token!, password: 'NewPass123!!' });

      console.log('[DEBUG invite] acceptRes status:', acceptRes.status, 'body:', acceptRes.body);
      expect(acceptRes.status).toBe(204);

      // User can now login
      const loginRes = await request(app)
        .post('/auth/login')
        .send({ email: 'invite@example.com', password: 'NewPass123!!' });
      expect(loginRes.status).toBe(200);
    });

    it('returns 400 for short password', async () => {
      const res = await request(app)
        .post('/auth/accept-invitation')
        .send({ token: 'abc', password: 'short' });
      expect(res.status).toBe(400);
    });

    it('returns 400 for reused token', async () => {
      const res1 = await request(app)
        .post('/users')
        .set(authHeader(superAdmin.accessToken))
        .send({ email: 'reuse@example.com' });
      const token = getLastInvitationToken();

      await request(app)
        .post('/auth/accept-invitation')
        .send({ token: token!, password: 'NewPass123!!' });

      const res2 = await request(app)
        .post('/auth/accept-invitation')
        .send({ token: token!, password: 'NewPass123!!' });
      expect(res2.status).toBe(400);
    });

    it('concurrent accept: only one succeeds', async () => {
      const res = await request(app)
        .post('/users')
        .set(authHeader(superAdmin.accessToken))
        .send({ email: 'concurrent@example.com' });
      const token = getLastInvitationToken();

      const [r1, r2] = await Promise.all([
        request(app).post('/auth/accept-invitation').send({ token: token!, password: 'Pass12345678!!' }),
        request(app).post('/auth/accept-invitation').send({ token: token!, password: 'Pass12345678!!' }),
      ]);

      const statuses = [r1.status, r2.status].sort();
      expect(statuses).toEqual([204, 400]);
    });
  });
});