import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import request from 'supertest';
import { truncateTestDatabase, createTestUser, authHeader, getPrisma } from '../setup.js';

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

describe('PATCH /users/:id/role - SUPER_ADMIN only', () => {
  let superAdmin: Awaited<ReturnType<typeof createTestUser>>;
  let admin: Awaited<ReturnType<typeof createTestUser>>;
  let agent: Awaited<ReturnType<typeof createTestUser>>;
  let user: Awaited<ReturnType<typeof createTestUser>>;
  let anotherSuperAdmin: Awaited<ReturnType<typeof createTestUser>>;

  beforeEach(async () => {
    await truncateTestDatabase();

    superAdmin = await createTestUser('SUPER_ADMIN', 'ACTIVE');
    admin = await createTestUser('ADMIN', 'ACTIVE');
    agent = await createTestUser('AGENT', 'ACTIVE');
    user = await createTestUser('USER', 'ACTIVE');
    anotherSuperAdmin = await createTestUser('SUPER_ADMIN', 'ACTIVE');
  });

  // ========================================================================
  // Authorization
  // ========================================================================
  describe('Authorization', () => {
    it('SUPER_ADMIN can change role', async () => {
      const res = await request(app)
        .patch(`/users/${user.id}/role`)
        .set(authHeader(superAdmin.accessToken))
        .send({ role: 'ADMIN' });

      expect(res.status).toBe(200);
      expect(res.body.role).toBe('ADMIN');
    });

    it('ADMIN gets 403', async () => {
      const res = await request(app)
        .patch(`/users/${user.id}/role`)
        .set(authHeader(admin.accessToken))
        .send({ role: 'ADMIN' });

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'Forbidden' });
    });

    it('AGENT gets 403', async () => {
      const res = await request(app)
        .patch(`/users/${user.id}/role`)
        .set(authHeader(agent.accessToken))
        .send({ role: 'ADMIN' });

      expect(res.status).toBe(403);
    });

    it('USER gets 403', async () => {
      const res = await request(app)
        .patch(`/users/${user.id}/role`)
        .set(authHeader(user.accessToken))
        .send({ role: 'ADMIN' });

      expect(res.status).toBe(403);
    });

    it('without token returns 401', async () => {
      const res = await request(app)
        .patch(`/users/${user.id}/role`)
        .send({ role: 'ADMIN' });

      expect(res.status).toBe(401);
    });
  });

  // ========================================================================
  // Business logic
  // ========================================================================
  describe('Business logic', () => {
    it('changing own role returns 400', async () => {
      const res = await request(app)
        .patch(`/users/${superAdmin.id}/role`)
        .set(authHeader(superAdmin.accessToken))
        .send({ role: 'ADMIN' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Cannot change your own role');
    });

    it('demoting another SUPER_ADMIN when 2 active SUPER_ADMINs exist succeeds', async () => {
      // Both superAdmin and anotherSuperAdmin are ACTIVE SUPER_ADMINs
      const res = await request(app)
        .patch(`/users/${anotherSuperAdmin.id}/role`)
        .set(authHeader(superAdmin.accessToken))
        .send({ role: 'ADMIN' });

      expect(res.status).toBe(200);
      expect(res.body.role).toBe('ADMIN');
    });

    it('unknown user id returns 404', async () => {
      const res = await request(app)
        .patch('/users/00000000-0000-0000-0000-000000000000/role')
        .set(authHeader(superAdmin.accessToken))
        .send({ role: 'ADMIN' });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Not found' });
    });

    it('invalid role returns 400', async () => {
      const res = await request(app)
        .patch(`/users/${user.id}/role`)
        .set(authHeader(superAdmin.accessToken))
        .send({ role: 'INVALID' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
    });

    it('SUPER_ADMIN role not allowed in body returns 400', async () => {
      const res = await request(app)
        .patch(`/users/${user.id}/role`)
        .set(authHeader(superAdmin.accessToken))
        .send({ role: 'SUPER_ADMIN' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
    });

    it('extra field in body returns 400', async () => {
      const res = await request(app)
        .patch(`/users/${user.id}/role`)
        .set(authHeader(superAdmin.accessToken))
        .send({ role: 'ADMIN', extra: 'field' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
    });

    it('changing role from USER to AGENT works', async () => {
      const res = await request(app)
        .patch(`/users/${user.id}/role`)
        .set(authHeader(superAdmin.accessToken))
        .send({ role: 'AGENT' });

      expect(res.status).toBe(200);
      expect(res.body.role).toBe('AGENT');
    });

    it('changing role from ADMIN to USER works', async () => {
      const res = await request(app)
        .patch(`/users/${admin.id}/role`)
        .set(authHeader(superAdmin.accessToken))
        .send({ role: 'USER' });

      expect(res.status).toBe(200);
      expect(res.body.role).toBe('USER');
    });

    it('changing role of DISABLED user works', async () => {
      await prisma.user.update({
        where: { id: user.id },
        data: { status: 'DISABLED' },
      });

      const res = await request(app)
        .patch(`/users/${user.id}/role`)
        .set(authHeader(superAdmin.accessToken))
        .send({ role: 'ADMIN' });

      expect(res.status).toBe(200);
      expect(res.body.role).toBe('ADMIN');
      expect(res.body.status).toBe('DISABLED');
    });
  });

  // ========================================================================
  // Audit log creation
  // ========================================================================
  describe('Audit log', () => {
    it('creates audit log with correct actor, target, action, and metadata', async () => {
      const res = await request(app)
        .patch(`/users/${user.id}/role`)
        .set(authHeader(superAdmin.accessToken))
        .send({ role: 'ADMIN' });

      expect(res.status).toBe(200);

      const p = await getPrisma();
      const audit = await p.auditLog.findFirst({
        where: { targetId: user.id, action: 'ROLE_CHANGED' },
        orderBy: { createdAt: 'desc' },
      });

      expect(audit).toBeTruthy();
      expect(audit!.actorId).toBe(superAdmin.id);
      expect(audit!.targetType).toBe('User');
      expect(audit!.targetId).toBe(user.id);
      expect(audit!.action).toBe('ROLE_CHANGED');
      expect(audit!.metadata).toEqual({
        previousRole: 'USER',
        newRole: 'ADMIN',
      });
    });

    it('no audit log for 403 (ADMIN trying to change role)', async () => {
      await request(app)
        .patch(`/users/${user.id}/role`)
        .set(authHeader(admin.accessToken))
        .send({ role: 'ADMIN' });

      const p = await getPrisma();
      const audit = await p.auditLog.findFirst({
        where: { targetId: user.id, action: 'ROLE_CHANGED' },
      });

      expect(audit).toBeNull();
    });

    it('no audit log for 400 (changing own role)', async () => {
      await request(app)
        .patch(`/users/${superAdmin.id}/role`)
        .set(authHeader(superAdmin.accessToken))
        .send({ role: 'ADMIN' });

      const p = await getPrisma();
      const audit = await p.auditLog.findFirst({
        where: { targetId: superAdmin.id, action: 'ROLE_CHANGED' },
      });

      expect(audit).toBeNull();
    });

    it('no audit log for 404 (unknown user)', async () => {
      await request(app)
        .patch('/users/00000000-0000-0000-0000-000000000000/role')
        .set(authHeader(superAdmin.accessToken))
        .send({ role: 'ADMIN' });

      const p = await getPrisma();
      const audit = await p.auditLog.findFirst({
        where: { action: 'ROLE_CHANGED' },
      });

      expect(audit).toBeNull();
    });

    it('no audit log for 400 (invalid role)', async () => {
      await request(app)
        .patch(`/users/${user.id}/role`)
        .set(authHeader(superAdmin.accessToken))
        .send({ role: 'INVALID' });

      const p = await getPrisma();
      const audit = await p.auditLog.findFirst({
        where: { action: 'ROLE_CHANGED' },
      });

      expect(audit).toBeNull();
    });
  });
});