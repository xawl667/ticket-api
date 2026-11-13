import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
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

describe('GET /tickets - pagination, sorting, filtering', () => {
  let superAdmin: Awaited<ReturnType<typeof createTestUser>>;
  let admin: Awaited<ReturnType<typeof createTestUser>>;
  let agent: Awaited<ReturnType<typeof createTestUser>>;
  let user1: Awaited<ReturnType<typeof createTestUser>>;
  let user2: Awaited<ReturnType<typeof createTestUser>>;

  beforeEach(async () => {
    await truncateTestDatabase();

    superAdmin = await createTestUser('SUPER_ADMIN', 'ACTIVE');
    admin = await createTestUser('ADMIN', 'ACTIVE');
    agent = await createTestUser('AGENT', 'ACTIVE');
    user1 = await createTestUser('USER', 'ACTIVE');
    user2 = await createTestUser('USER', 'ACTIVE');

    // Create 25 tickets for user1 (to test pagination)
    for (let i = 0; i < 25; i++) {
      await prisma.ticket.create({
        data: {
          title: `User1 Ticket ${i.toString().padStart(3, '0')}`,
          description: `Description ${i}`,
          status: i % 4 === 0 ? 'OPEN' : i % 4 === 1 ? 'IN_PROGRESS' : i % 4 === 2 ? 'RESOLVED' : 'CLOSED',
          createdById: user1.id,
        },
      });
    }
    // Create 5 tickets for user2
    for (let i = 0; i < 5; i++) {
      await prisma.ticket.create({
        data: {
          title: `User2 Ticket ${i}`,
          description: `Description ${i}`,
          status: 'OPEN',
          createdById: user2.id,
        },
      });
    }
    // Create 3 orphan tickets
    for (let i = 0; i < 3; i++) {
      await prisma.ticket.create({
        data: {
          title: `Orphan Ticket ${i}`,
          description: `Description ${i}`,
          status: 'OPEN',
          createdById: null,
        },
      });
    }
  });

  // ========================================================================
  // Pagination
  // ========================================================================
  describe('Pagination', () => {
    it('SUPER_ADMIN: default page=1, limit=20', async () => {
      const res = await request(app)
        .get('/tickets')
        .set(authHeader(superAdmin.accessToken));

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(20);
      expect(res.body.meta).toEqual({
        page: 1,
        limit: 20,
        total: 33,
        totalPages: 2,
      });
    });

    it('SUPER_ADMIN: page=2 returns remaining items', async () => {
      const res = await request(app)
        .get('/tickets?page=2&limit=20')
        .set(authHeader(superAdmin.accessToken));

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(13);
      expect(res.body.meta).toEqual({
        page: 2,
        limit: 20,
        total: 33,
        totalPages: 2,
      });
    });

    it('SUPER_ADMIN: last page with exact division', async () => {
      // 33 tickets, limit=11 -> 3 pages exactly
      const res = await request(app)
        .get('/tickets?page=3&limit=11')
        .set(authHeader(superAdmin.accessToken));

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(11);
      expect(res.body.meta).toEqual({
        page: 3,
        limit: 11,
        total: 33,
        totalPages: 3,
      });
    });

    it('SUPER_ADMIN: page beyond total returns empty data', async () => {
      const res = await request(app)
        .get('/tickets?page=5&limit=10')
        .set(authHeader(superAdmin.accessToken));

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.meta).toEqual({
        page: 5,
        limit: 10,
        total: 33,
        totalPages: 4,
      });
    });

    it('USER: pagination only counts own tickets', async () => {
      const res = await request(app)
        .get('/tickets?page=1&limit=10')
        .set(authHeader(user1.accessToken));

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(10);
      expect(res.body.meta).toEqual({
        page: 1,
        limit: 10,
        total: 25,
        totalPages: 3,
      });
    });

    it('USER: page=2 for own tickets', async () => {
      const res = await request(app)
        .get('/tickets?page=2&limit=10')
        .set(authHeader(user1.accessToken));

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(10);
      expect(res.body.meta.total).toBe(25);
    });
  });

  // ========================================================================
  // Sorting
  // ========================================================================
  describe('Sorting', () => {
    it('SUPER_ADMIN: sort=createdAt order=desc (default)', async () => {
      const res = await request(app)
        .get('/tickets?limit=5&sort=createdAt&order=desc')
        .set(authHeader(superAdmin.accessToken));

      expect(res.status).toBe(200);
      const dates = res.body.data.map((t: any) => new Date(t.createdAt).getTime());
      for (let i = 1; i < dates.length; i++) {
        expect(dates[i]).toBeLessThanOrEqual(dates[i - 1]);
      }
    });

    it('SUPER_ADMIN: sort=createdAt order=asc', async () => {
      const res = await request(app)
        .get('/tickets?limit=5&sort=createdAt&order=asc')
        .set(authHeader(superAdmin.accessToken));

      expect(res.status).toBe(200);
      const dates = res.body.data.map((t: any) => new Date(t.createdAt).getTime());
      for (let i = 1; i < dates.length; i++) {
        expect(dates[i]).toBeGreaterThanOrEqual(dates[i - 1]);
      }
    });

    it('SUPER_ADMIN: sort=updatedAt order=desc', async () => {
      const res = await request(app)
        .get('/tickets?limit=5&sort=updatedAt&order=desc')
        .set(authHeader(superAdmin.accessToken));

      expect(res.status).toBe(200);
      const dates = res.body.data.map((t: any) => new Date(t.updatedAt).getTime());
      for (let i = 1; i < dates.length; i++) {
        expect(dates[i]).toBeLessThanOrEqual(dates[i - 1]);
      }
    });

    it('SUPER_ADMIN: sort=updatedAt order=asc', async () => {
      const res = await request(app)
        .get('/tickets?limit=5&sort=updatedAt&order=asc')
        .set(authHeader(superAdmin.accessToken));

      expect(res.status).toBe(200);
      const dates = res.body.data.map((t: any) => new Date(t.updatedAt).getTime());
      for (let i = 1; i < dates.length; i++) {
        expect(dates[i]).toBeGreaterThanOrEqual(dates[i - 1]);
      }
    });

    it('SUPER_ADMIN: sort=status order=asc', async () => {
      const res = await request(app)
        .get('/tickets?limit=33&sort=status&order=asc')
        .set(authHeader(superAdmin.accessToken));

      expect(res.status).toBe(200);
      const statuses = res.body.data.map((t: any) => t.status);
      // Prisma enum order: OPEN, IN_PROGRESS, RESOLVED, CLOSED
      expect(statuses).toEqual([...statuses].sort((a, b) => {
        const order = { OPEN: 0, IN_PROGRESS: 1, RESOLVED: 2, CLOSED: 3 };
        return order[a as keyof typeof order] - order[b as keyof typeof order];
      }));
    });

    it('SUPER_ADMIN: sort=status order=desc', async () => {
      const res = await request(app)
        .get('/tickets?limit=33&sort=status&order=desc')
        .set(authHeader(superAdmin.accessToken));

      expect(res.status).toBe(200);
      const statuses = res.body.data.map((t: any) => t.status);
      // Prisma enum order reversed: CLOSED, RESOLVED, IN_PROGRESS, OPEN
      expect(statuses).toEqual([...statuses].sort((a, b) => {
        const order = { OPEN: 0, IN_PROGRESS: 1, RESOLVED: 2, CLOSED: 3 };
        return order[b as keyof typeof order] - order[a as keyof typeof order];
      }));
    });
  });

  // ========================================================================
  // Filtering + Sorting combined
  // ========================================================================
  describe('Filtering + Sorting combined', () => {
    it('SUPER_ADMIN: status=OPEN + sort=createdAt order=asc', async () => {
      const res = await request(app)
        .get('/tickets?status=OPEN&sort=createdAt&order=asc&limit=50')
        .set(authHeader(superAdmin.accessToken));

      expect(res.status).toBe(200);
      expect(res.body.data.every((t: any) => t.status === 'OPEN')).toBe(true);
      const dates = res.body.data.map((t: any) => new Date(t.createdAt).getTime());
      for (let i = 1; i < dates.length; i++) {
        expect(dates[i]).toBeGreaterThanOrEqual(dates[i - 1]);
      }
    });

    it('USER: status filter only applies to own tickets', async () => {
      // user1 has some RESOLVED tickets (every 4th)
      const res = await request(app)
        .get('/tickets?status=RESOLVED&limit=50')
        .set(authHeader(user1.accessToken));

      expect(res.status).toBe(200);
      expect(res.body.data.every((t: any) => t.status === 'RESOLVED')).toBe(true);
      expect(res.body.meta.total).toBe(6); // 25 tickets, every 4th = 6 (indices 0,4,8,12,16,20,24 -> 7 actually, but 0-based: 0,4,8,12,16,20,24 = 7)
    });
  });

  // ========================================================================
  // Limit max 100
  // ========================================================================
  describe('Limit max 100', () => {
    it('limit=100 returns up to 100 items', async () => {
      const res = await request(app)
        .get('/tickets?limit=100')
        .set(authHeader(superAdmin.accessToken));

      expect(res.status).toBe(200);
      expect(res.body.meta.limit).toBe(100);
    });

    it('limit=200 is capped to 100', async () => {
      const res = await request(app)
        .get('/tickets?limit=200')
        .set(authHeader(superAdmin.accessToken));

      expect(res.status).toBe(200);
      expect(res.body.meta.limit).toBe(100);
    });

    it('limit=1000 is capped to 100', async () => {
      const res = await request(app)
        .get('/tickets?limit=1000')
        .set(authHeader(superAdmin.accessToken));

      expect(res.status).toBe(200);
      expect(res.body.meta.limit).toBe(100);
    });
  });

  // ========================================================================
  // Invalid values = 400
  // ========================================================================
  describe('Invalid query parameters = 400', () => {
    it('page=0 returns 400', async () => {
      const res = await request(app)
        .get('/tickets?page=0')
        .set(authHeader(superAdmin.accessToken));
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
    });

    it('page=-1 returns 400', async () => {
      const res = await request(app)
        .get('/tickets?page=-1')
        .set(authHeader(superAdmin.accessToken));
      expect(res.status).toBe(400);
    });

    it('limit=0 returns 400', async () => {
      const res = await request(app)
        .get('/tickets?limit=0')
        .set(authHeader(superAdmin.accessToken));
      expect(res.status).toBe(400);
    });

    it('limit=1000 returns 200 but capped (not 400)', async () => {
      const res = await request(app)
        .get('/tickets?limit=1000')
        .set(authHeader(superAdmin.accessToken));
      expect(res.status).toBe(200);
      expect(res.body.meta.limit).toBe(100);
    });

    it('sort=passwordHash returns 400', async () => {
      const res = await request(app)
        .get('/tickets?sort=passwordHash')
        .set(authHeader(superAdmin.accessToken));
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
    });

    it('sort=email returns 400', async () => {
      const res = await request(app)
        .get('/tickets?sort=email')
        .set(authHeader(superAdmin.accessToken));
      expect(res.status).toBe(400);
    });

    it('order=x returns 400', async () => {
      const res = await request(app)
        .get('/tickets?order=x')
        .set(authHeader(superAdmin.accessToken));
      expect(res.status).toBe(400);
    });

    it('order=ascending returns 400', async () => {
      const res = await request(app)
        .get('/tickets?order=ascending')
        .set(authHeader(superAdmin.accessToken));
      expect(res.status).toBe(400);
    });

    it('unknown parameter returns 400', async () => {
      const res = await request(app)
        .get('/tickets?foo=bar')
        .set(authHeader(superAdmin.accessToken));
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
    });

    it('invalid status returns 400', async () => {
      const res = await request(app)
        .get('/tickets?status=INVALID')
        .set(authHeader(superAdmin.accessToken));
      expect(res.status).toBe(400);
    });
  });
});