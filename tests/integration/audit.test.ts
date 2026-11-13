import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import request from 'supertest';
import { truncateTestDatabase, createTestUser, createTestUserWithRefreshToken, authHeader, getCapturedEmails, getLastInvitationToken, getLastResetToken, getPrisma, clearCapturedEmails } from '../setup.js';

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

describe('Audit logs - creation and retrieval', () => {
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
  // Audit log creation for each action
  // ========================================================================
  describe('Audit log creation', () => {
    it('USER_INVITED when SUPER_ADMIN creates user', async () => {
      const res = await request(app)
        .post('/users')
        .set(authHeader(superAdmin.accessToken))
        .send({ email: 'invited@example.com', role: 'USER' });

      expect(res.status).toBe(201);

      const p = await getPrisma();
      const audit = await p.auditLog.findFirst({
        where: { targetId: res.body.id, action: 'USER_INVITED' },
        orderBy: { createdAt: 'desc' },
      });

      expect(audit).toBeTruthy();
      expect(audit!.actorId).toBe(superAdmin.id);
      expect(audit!.targetType).toBe('User');
      expect(audit!.targetId).toBe(res.body.id);
      expect(audit!.action).toBe('USER_INVITED');
      expect(audit!.metadata).toEqual({ role: 'USER', email: 'invited@example.com' });
    });

    it('INVITATION_ACCEPTED when user accepts invitation', async () => {
      const createRes = await request(app)
        .post('/users')
        .set(authHeader(superAdmin.accessToken))
        .send({ email: 'accept@example.com', role: 'USER' });

      const token = getLastInvitationToken();
      expect(token).toBeTruthy();

      const acceptRes = await request(app)
        .post('/auth/accept-invitation')
        .send({ token: token!, password: 'NewPass123!!' });

      expect(acceptRes.status).toBe(204);

      const p = await getPrisma();
      const createdUser = await p.user.findUnique({ where: { email: 'accept@example.com' } });
      const audit = await p.auditLog.findFirst({
        where: { targetId: createdUser!.id, action: 'INVITATION_ACCEPTED' },
        orderBy: { createdAt: 'desc' },
      });

      expect(audit).toBeTruthy();
      expect(audit!.actorId).toBe(createdUser!.id);
      expect(audit!.targetType).toBe('User');
      expect(audit!.targetId).toBe(createdUser!.id);
      expect(audit!.action).toBe('INVITATION_ACCEPTED');
      expect(audit!.metadata).toEqual({});
    });

    it('USER_DISABLED when SUPER_ADMIN disables user', async () => {
      const target = await createTestUser('USER', 'ACTIVE', { password: 'TestPass123!' });

      const res = await request(app)
        .patch(`/users/${target.id}/disable`)
        .set(authHeader(superAdmin.accessToken));

      expect(res.status).toBe(200);

      const p = await getPrisma();
      const audit = await p.auditLog.findFirst({
        where: { targetId: target.id, action: 'USER_DISABLED' },
        orderBy: { createdAt: 'desc' },
      });

      expect(audit).toBeTruthy();
      expect(audit!.actorId).toBe(superAdmin.id);
      expect(audit!.targetType).toBe('User');
      expect(audit!.targetId).toBe(target.id);
      expect(audit!.action).toBe('USER_DISABLED');
      expect(audit!.metadata).toEqual({ previousStatus: 'ACTIVE', newStatus: 'DISABLED' });
    });

    it('USER_ENABLED when SUPER_ADMIN enables user', async () => {
      const target = await createTestUser('USER', 'DISABLED', { password: 'TestPass123!' });

      const res = await request(app)
        .patch(`/users/${target.id}/enable`)
        .set(authHeader(superAdmin.accessToken));

      expect(res.status).toBe(200);

      const p = await getPrisma();
      const audit = await p.auditLog.findFirst({
        where: { targetId: target.id, action: 'USER_ENABLED' },
        orderBy: { createdAt: 'desc' },
      });

      expect(audit).toBeTruthy();
      expect(audit!.actorId).toBe(superAdmin.id);
      expect(audit!.targetType).toBe('User');
      expect(audit!.targetId).toBe(target.id);
      expect(audit!.action).toBe('USER_ENABLED');
      expect(audit!.metadata).toEqual({ previousStatus: 'DISABLED', newStatus: 'ACTIVE' });
    });

    it('ROLE_CHANGED when SUPER_ADMIN changes role with metadata old/new role', async () => {
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
      expect(audit!.metadata).toEqual({ previousRole: 'USER', newRole: 'ADMIN' });
    });

    it('PASSWORD_RESET_COMPLETED when user resets password', async () => {
      const target = await createTestUser('USER', 'ACTIVE', { password: 'TestPass123!' });

      const forgotRes = await request(app)
        .post('/auth/forgot-password')
        .send({ email: target.email });

      expect(forgotRes.status).toBe(200);
      const token = getLastResetToken();
      expect(token).toBeTruthy();

      const resetRes = await request(app)
        .post('/auth/reset-password')
        .send({ token: token!, password: 'NewPass123!!' });

      expect(resetRes.status).toBe(204);

      const p = await getPrisma();
      const audit = await p.auditLog.findFirst({
        where: { targetId: target.id, action: 'PASSWORD_RESET_COMPLETED' },
        orderBy: { createdAt: 'desc' },
      });

      expect(audit).toBeTruthy();
      expect(audit!.actorId).toBe(target.id);
      expect(audit!.targetType).toBe('User');
      expect(audit!.targetId).toBe(target.id);
      expect(audit!.action).toBe('PASSWORD_RESET_COMPLETED');
      expect(audit!.metadata).toEqual({});
    });
  });

  // ========================================================================
  // No audit log for failed actions
  // ========================================================================
  describe('No audit log for failed actions', () => {
    it('no audit log for 403 (ADMIN trying to disable)', async () => {
      const target = await createTestUser('USER', 'ACTIVE');

      await request(app)
        .patch(`/users/${target.id}/disable`)
        .set(authHeader(admin.accessToken));

      const p = await getPrisma();
      const audit = await p.auditLog.findFirst({
        where: { targetId: target.id, action: 'USER_DISABLED' },
      });

      expect(audit).toBeNull();
    });

    it('no audit log for 400 (disabling self)', async () => {
      await request(app)
        .patch(`/users/${superAdmin.id}/disable`)
        .set(authHeader(superAdmin.accessToken));

      const p = await getPrisma();
      const audit = await p.auditLog.findFirst({
        where: { targetId: superAdmin.id, action: 'USER_DISABLED' },
      });

      expect(audit).toBeNull();
    });

    it('no audit log for 404 (unknown user)', async () => {
      await request(app)
        .patch('/users/00000000-0000-0000-0000-000000000000/disable')
        .set(authHeader(superAdmin.accessToken));

      const p = await getPrisma();
      const audit = await p.auditLog.findFirst({
        where: { action: 'USER_DISABLED' },
      });

      expect(audit).toBeNull();
    });

    it('no audit log for 403 (ADMIN trying to change role)', async () => {
      await request(app)
        .patch(`/users/${user.id}/role`)
        .set(authHeader(admin.accessToken))
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

    it('no audit log for 400 (changing own role)', async () => {
      await request(app)
        .patch(`/users/${superAdmin.id}/role`)
        .set(authHeader(superAdmin.accessToken))
        .send({ role: 'ADMIN' });

      const p = await getPrisma();
      const audit = await p.auditLog.findFirst({
        where: { action: 'ROLE_CHANGED' },
      });

      expect(audit).toBeNull();
    });
  });

  // ========================================================================
  // No sensitive data in metadata
  // ========================================================================
  describe('No sensitive data in metadata', () => {
    it('USER_INVITED metadata has no token, password, hash', async () => {
      const res = await request(app)
        .post('/users')
        .set(authHeader(superAdmin.accessToken))
        .send({ email: 'sensitive@example.com', role: 'USER' });

      const p = await getPrisma();
      const audit = await p.auditLog.findFirst({
        where: { targetId: res.body.id, action: 'USER_INVITED' },
        orderBy: { createdAt: 'desc' },
      });

      const metaStr = JSON.stringify(audit!.metadata);
      expect(metaStr).not.toMatch(/token/i);
      expect(metaStr).not.toMatch(/password/i);
      expect(metaStr).not.toMatch(/hash/i);
    });

    it('INVITATION_ACCEPTED metadata has no token, password', async () => {
      const createRes = await request(app)
        .post('/users')
        .set(authHeader(superAdmin.accessToken))
        .send({ email: 'accept2@example.com', role: 'USER' });

      const token = getLastInvitationToken();
      await request(app)
        .post('/auth/accept-invitation')
        .send({ token: token!, password: 'NewPass123!!' });

      const p = await getPrisma();
      const createdUser = await p.user.findUnique({ where: { email: 'accept2@example.com' } });
      const audit = await p.auditLog.findFirst({
        where: { targetId: createdUser!.id, action: 'INVITATION_ACCEPTED' },
        orderBy: { createdAt: 'desc' },
      });

      const metaStr = JSON.stringify(audit!.metadata);
      expect(metaStr).not.toMatch(/token/i);
      expect(metaStr).not.toMatch(/password/i);
    });

    it('PASSWORD_RESET_COMPLETED metadata has no token, password', async () => {
      const target = await createTestUser('USER', 'ACTIVE', { password: 'TestPass123!' });
      await request(app).post('/auth/forgot-password').send({ email: target.email });
      const token = getLastResetToken();
      await request(app).post('/auth/reset-password').send({ token: token!, password: 'NewPass123!!' });

      const p = await getPrisma();
      const audit = await p.auditLog.findFirst({
        where: { targetId: target.id, action: 'PASSWORD_RESET_COMPLETED' },
        orderBy: { createdAt: 'desc' },
      });

      const metaStr = JSON.stringify(audit!.metadata);
      expect(metaStr).not.toMatch(/token/i);
      expect(metaStr).not.toMatch(/password/i);
    });

    it('USER_DISABLED metadata has no email', async () => {
      const target = await createTestUser('USER', 'ACTIVE');
      await request(app).patch(`/users/${target.id}/disable`).set(authHeader(superAdmin.accessToken));

      const p = await getPrisma();
      const audit = await p.auditLog.findFirst({
        where: { targetId: target.id, action: 'USER_DISABLED' },
        orderBy: { createdAt: 'desc' },
      });

      const metaStr = JSON.stringify(audit!.metadata);
      expect(metaStr).not.toMatch(/email/i);
    });
  });

  // ========================================================================
  // Atomicity: if action fails, no audit log
  // ========================================================================
  describe('Atomicity: failed action = no audit log', () => {
    it('disable last SUPER_ADMIN fails and no audit log', async () => {
      // Create a second SUPER_ADMIN
      const sa2 = await createTestUser('SUPER_ADMIN', 'ACTIVE');
      // Disable the first one
      await prisma.user.update({ where: { id: superAdmin.id }, data: { status: 'DISABLED' } });

      // Try to disable the last active SUPER_ADMIN (sa2)
      await request(app)
        .patch(`/users/${sa2.id}/disable`)
        .set(authHeader(superAdmin.accessToken));

      const p = await getPrisma();
      const audit = await p.auditLog.findFirst({
        where: { targetId: sa2.id, action: 'USER_DISABLED' },
      });

      expect(audit).toBeNull();
    });

    it('enable non-DISABLED user fails and no audit log', async () => {
      await request(app)
        .patch(`/users/${user.id}/enable`)
        .set(authHeader(superAdmin.accessToken));

      const p = await getPrisma();
      const audit = await p.auditLog.findFirst({
        where: { targetId: user.id, action: 'USER_ENABLED' },
      });

      expect(audit).toBeNull();
    });

    it('accept invalid invitation token fails and no audit log', async () => {
      await request(app)
        .post('/auth/accept-invitation')
        .send({ token: 'invalid', password: 'NewPass123!!' });

      const p = await getPrisma();
      const audit = await p.auditLog.findFirst({
        where: { action: 'INVITATION_ACCEPTED' },
      });

      expect(audit).toBeNull();
    });

    it('reset with invalid token fails and no audit log', async () => {
      await request(app)
        .post('/auth/reset-password')
        .send({ token: 'invalid', password: 'NewPass123!!' });

      const p = await getPrisma();
      const audit = await p.auditLog.findFirst({
        where: { action: 'PASSWORD_RESET_COMPLETED' },
      });

      expect(audit).toBeNull();
    });
  });

  // ========================================================================
  // GET /audit-logs endpoint
  // ========================================================================
  describe('GET /audit-logs', () => {
    beforeEach(async () => {
      // Create some audit logs
      await request(app).post('/users').set(authHeader(superAdmin.accessToken)).send({ email: 'audit1@example.com' });
      await request(app).post('/users').set(authHeader(superAdmin.accessToken)).send({ email: 'audit2@example.com' });
      const target = await createTestUser('USER', 'ACTIVE');
      await request(app).patch(`/users/${target.id}/disable`).set(authHeader(superAdmin.accessToken));
      await request(app).patch(`/users/${target.id}/enable`).set(authHeader(superAdmin.accessToken));
      await request(app).patch(`/users/${user.id}/role`).set(authHeader(superAdmin.accessToken)).send({ role: 'ADMIN' });
    });

    it('SUPER_ADMIN can access', async () => {
      const res = await request(app)
        .get('/audit-logs')
        .set(authHeader(superAdmin.accessToken));

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.meta).toHaveProperty('total');
    });

    it('ADMIN gets 403', async () => {
      const res = await request(app)
        .get('/audit-logs')
        .set(authHeader(admin.accessToken));

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'Forbidden' });
    });

    it('AGENT gets 403', async () => {
      const res = await request(app)
        .get('/audit-logs')
        .set(authHeader(agent.accessToken));

      expect(res.status).toBe(403);
    });

    it('USER gets 403', async () => {
      const res = await request(app)
        .get('/audit-logs')
        .set(authHeader(user.accessToken));

      expect(res.status).toBe(403);
    });

    it('without token returns 401', async () => {
      const res = await request(app).get('/audit-logs');
      expect(res.status).toBe(401);
    });

    it('pagination works', async () => {
      const res1 = await request(app)
        .get('/audit-logs?page=1&limit=2')
        .set(authHeader(superAdmin.accessToken));

      expect(res1.status).toBe(200);
      expect(res1.body.data.length).toBe(2);
      expect(res1.body.meta.page).toBe(1);
      expect(res1.body.meta.limit).toBe(2);

      const res2 = await request(app)
        .get('/audit-logs?page=2&limit=2')
        .set(authHeader(superAdmin.accessToken));

      expect(res2.status).toBe(200);
      expect(res2.body.meta.page).toBe(2);
    });

    it('filter by action', async () => {
      const res = await request(app)
        .get('/audit-logs?action=USER_INVITED')
        .set(authHeader(superAdmin.accessToken));

      expect(res.status).toBe(200);
      expect(res.body.data.every((a: any) => a.action === 'USER_INVITED')).toBe(true);
    });

    it('filter by actorId', async () => {
      const res = await request(app)
        .get(`/audit-logs?actorId=${superAdmin.id}`)
        .set(authHeader(superAdmin.accessToken));

      expect(res.status).toBe(200);
      expect(res.body.data.every((a: any) => a.actorId === superAdmin.id)).toBe(true);
    });

    it('sort by createdAt desc (default)', async () => {
      const res = await request(app)
        .get('/audit-logs?limit=10')
        .set(authHeader(superAdmin.accessToken));

      expect(res.status).toBe(200);
      const dates = res.body.data.map((a: any) => new Date(a.createdAt).getTime());
      for (let i = 1; i < dates.length; i++) {
        expect(dates[i]).toBeLessThanOrEqual(dates[i - 1]);
      }
    });

    it('sort by createdAt asc', async () => {
      const res = await request(app)
        .get('/audit-logs?limit=10&sortOrder=asc')
        .set(authHeader(superAdmin.accessToken));

      expect(res.status).toBe(200);
      const dates = res.body.data.map((a: any) => new Date(a.createdAt).getTime());
      for (let i = 1; i < dates.length; i++) {
        expect(dates[i]).toBeGreaterThanOrEqual(dates[i - 1]);
      }
    });

    it('no sensitive fields in response', async () => {
      const res = await request(app)
        .get('/audit-logs')
        .set(authHeader(superAdmin.accessToken));

      expect(res.status).toBe(200);
      const bodyStr = JSON.stringify(res.body);
      expect(bodyStr).not.toMatch(/password/i);
      expect(bodyStr).not.toMatch(/token/i);
      expect(bodyStr).not.toMatch(/hash/i);
    });
  });
});