import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import request from 'supertest';
import { truncateTestDatabase, createTestUser, authHeader } from '../setup.js';

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

describe('Tickets integration (RBAC matrix)', () => {
  let superAdmin: Awaited<ReturnType<typeof createTestUser>>;
  let admin: Awaited<ReturnType<typeof createTestUser>>;
  let agent: Awaited<ReturnType<typeof createTestUser>>;
  let user1: Awaited<ReturnType<typeof createTestUser>>;
  let user2: Awaited<ReturnType<typeof createTestUser>>;

  let user1Ticket: { id: string; title: string; createdById: string };
  let user2Ticket: { id: string; title: string; createdById: string };
  let orphanTicket: { id: string; title: string; createdById: string | null };

  beforeEach(async () => {
    await truncateTestDatabase();

    superAdmin = await createTestUser('SUPER_ADMIN', 'ACTIVE');
    admin = await createTestUser('ADMIN', 'ACTIVE');
    agent = await createTestUser('AGENT', 'ACTIVE');
    user1 = await createTestUser('USER', 'ACTIVE');
    user2 = await createTestUser('USER', 'ACTIVE');

    // Create tickets
    user1Ticket = await prisma.ticket.create({
      data: { title: 'User1 Ticket', description: 'Desc', createdById: user1.id },
    });
    user2Ticket = await prisma.ticket.create({
      data: { title: 'User2 Ticket', description: 'Desc', createdById: user2.id },
    });
    orphanTicket = await prisma.ticket.create({
      data: { title: 'Orphan Ticket', description: 'No creator', createdById: null },
    });
  });

  // ========================================================================
  // POST /tickets - all authenticated roles can create
  // ========================================================================
  describe('POST /tickets', () => {
    for (const role of ['SUPER_ADMIN', 'ADMIN', 'AGENT', 'USER'] as const) {
      it(`allows ${role} to create ticket`, async () => {
        const u = await createTestUser(role, 'ACTIVE');
        const res = await request(app)
          .post('/tickets')
          .set(authHeader(u.accessToken))
          .send({ title: 'New Ticket', description: 'Description' });

        expect(res.status).toBe(201);
        expect(res.body).toHaveProperty('id');
        expect(res.body.title).toBe('New Ticket');
        expect(res.body.createdById).toBe(u.id);
      });
    }

    it('ignores createdById in body (Zod .strict rejects extra fields)', async () => {
      const res = await request(app)
        .post('/tickets')
        .set(authHeader(user1.accessToken))
        .send({ title: 'Test', description: 'Desc', createdById: user2.id });

      // .strict() on createTicketSchema rejects extra fields -> 400
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
    });

    it('returns 401 without auth', async () => {
      const res = await request(app).post('/tickets').send({ title: 'x', description: 'y' });
      expect(res.status).toBe(401);
    });
  });

  // ========================================================================
  // GET /tickets - visibility rules
  // ========================================================================
  describe('GET /tickets', () => {
    it('SUPER_ADMIN sees all tickets including orphan', async () => {
      const res = await request(app)
        .get('/tickets')
        .set(authHeader(superAdmin.accessToken));

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      const ids = res.body.map((t: any) => t.id).sort();
      expect(ids).toEqual([orphanTicket.id, user1Ticket.id, user2Ticket.id].sort());
    });

    it('ADMIN sees all tickets including orphan', async () => {
      const res = await request(app)
        .get('/tickets')
        .set(authHeader(admin.accessToken));

      expect(res.status).toBe(200);
      const ids = res.body.map((t: any) => t.id).sort();
      expect(ids).toEqual([orphanTicket.id, user1Ticket.id, user2Ticket.id].sort());
    });

    it('AGENT sees all tickets including orphan', async () => {
      const res = await request(app)
        .get('/tickets')
        .set(authHeader(agent.accessToken));

      expect(res.status).toBe(200);
      const ids = res.body.map((t: any) => t.id).sort();
      expect(ids).toEqual([orphanTicket.id, user1Ticket.id, user2Ticket.id].sort());
    });

    it('USER sees only own tickets, not orphan', async () => {
      const res = await request(app)
        .get('/tickets')
        .set(authHeader(user1.accessToken));

      expect(res.status).toBe(200);
      const ids = res.body.map((t: any) => t.id).sort();
      expect(ids).toEqual([user1Ticket.id]);
    });

    it('filters by status for all roles', async () => {
      await prisma.ticket.update({ where: { id: user1Ticket.id }, data: { status: 'RESOLVED' } });

      const res = await request(app)
        .get('/tickets?status=RESOLVED')
        .set(authHeader(superAdmin.accessToken));

      expect(res.status).toBe(200);
      expect(res.body.every((t: any) => t.status === 'RESOLVED')).toBe(true);
    });
  });

  // ========================================================================
  // GET /tickets/:id - visibility rules
  // ========================================================================
  describe('GET /tickets/:id', () => {
    it('SUPER_ADMIN can view any ticket', async () => {
      for (const ticket of [user1Ticket, user2Ticket, orphanTicket]) {
        const res = await request(app)
          .get(`/tickets/${ticket.id}`)
          .set(authHeader(superAdmin.accessToken));
        expect(res.status).toBe(200);
        expect(res.body.id).toBe(ticket.id);
      }
    });

    it('ADMIN can view any ticket', async () => {
      for (const ticket of [user1Ticket, user2Ticket, orphanTicket]) {
        const res = await request(app)
          .get(`/tickets/${ticket.id}`)
          .set(authHeader(admin.accessToken));
        expect(res.status).toBe(200);
      }
    });

    it('AGENT can view any ticket', async () => {
      for (const ticket of [user1Ticket, user2Ticket, orphanTicket]) {
        const res = await request(app)
          .get(`/tickets/${ticket.id}`)
          .set(authHeader(agent.accessToken));
        expect(res.status).toBe(200);
      }
    });

    it('USER can view own ticket (200)', async () => {
      const res = await request(app)
        .get(`/tickets/${user1Ticket.id}`)
        .set(authHeader(user1.accessToken));
      expect(res.status).toBe(200);
    });

    it('USER gets 404 for another user ticket (not 403)', async () => {
      const res = await request(app)
        .get(`/tickets/${user2Ticket.id}`)
        .set(authHeader(user1.accessToken));
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Not found' });
    });

    it('USER gets 404 for orphan ticket', async () => {
      const res = await request(app)
        .get(`/tickets/${orphanTicket.id}`)
        .set(authHeader(user1.accessToken));
      expect(res.status).toBe(404);
    });

    it('returns 404 for non-existent ticket', async () => {
      const res = await request(app)
        .get('/tickets/00000000-0000-0000-0000-000000000000')
        .set(authHeader(superAdmin.accessToken));
      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // PATCH /tickets/:id/status - SUPER_ADMIN, ADMIN, AGENT only
  // ========================================================================
  describe('PATCH /tickets/:id/status', () => {
    it('SUPER_ADMIN can update status', async () => {
      const res = await request(app)
        .patch(`/tickets/${user1Ticket.id}/status`)
        .set(authHeader(superAdmin.accessToken))
        .send({ status: 'IN_PROGRESS' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('IN_PROGRESS');
    });

    it('ADMIN can update status', async () => {
      const res = await request(app)
        .patch(`/tickets/${user1Ticket.id}/status`)
        .set(authHeader(admin.accessToken))
        .send({ status: 'RESOLVED' });
      expect(res.status).toBe(200);
    });

    it('AGENT can update status', async () => {
      const res = await request(app)
        .patch(`/tickets/${user1Ticket.id}/status`)
        .set(authHeader(agent.accessToken))
        .send({ status: 'CLOSED' });
      expect(res.status).toBe(200);
    });

    it('USER gets 403', async () => {
      const res = await request(app)
        .patch(`/tickets/${user1Ticket.id}/status`)
        .set(authHeader(user1.accessToken))
        .send({ status: 'IN_PROGRESS' });
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'Forbidden' });
    });

    it('returns 400 for invalid status', async () => {
      const res = await request(app)
        .patch(`/tickets/${user1Ticket.id}/status`)
        .set(authHeader(superAdmin.accessToken))
        .send({ status: 'INVALID' });
      expect(res.status).toBe(400);
    });

    it('returns 404 for non-existent ticket', async () => {
      const res = await request(app)
        .patch('/tickets/00000000-0000-0000-0000-000000000000/status')
        .set(authHeader(superAdmin.accessToken))
        .send({ status: 'OPEN' });
      expect(res.status).toBe(404);
    });
  });
});