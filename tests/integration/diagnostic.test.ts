import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import { truncateTestDatabase, createTestUser, authHeader, signTestAccessToken, getPrisma } from '../setup.js';

let app: any;
let verifyAccessToken: any;
let prisma: any;

beforeAll(async () => {
  const [appMod, tokensMod, prismaMod] = await Promise.all([
    import('../../src/app.js'),
    import('../../src/modules/auth/tokens.js'),
    import('../../src/shared/prisma.js'),
  ]);
  app = appMod.app;
  verifyAccessToken = tokensMod.verifyAccessToken;
  prisma = prismaMod.prisma;
});

describe('DIAGNOSTIC - must pass first', () => {
  beforeEach(async () => {
    await truncateTestDatabase();
  });

  it('1. Prisma connects to tickets_test database', async () => {
    const p = await getPrisma();
    // Use raw query to check current database
    const result = await p.$queryRaw<Array<{ current_database: string }>>`SELECT current_database()`;
    expect(result[0].current_database).toBe('tickets_test');
  });

  it('2. Test-signed token is accepted by src verifyAccessToken', () => {
    const payload = { sub: 'test-user-id', role: 'USER' };
    const token = signTestAccessToken(payload);
    const decoded = verifyAccessToken(token);
    expect(decoded.sub).toBe(payload.sub);
    expect(decoded.role).toBe(payload.role);
  });

  it('3. POST /auth/login on helper-created user returns 200', async () => {
    const user = await createTestUser('USER', 'ACTIVE', { password: 'TestPass123!' });
    const res = await request(app)
      .post('/auth/login')
      .send({ email: user.email, password: 'TestPass123!' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('accessToken');
    expect(res.body).toHaveProperty('refreshToken');
  });
});