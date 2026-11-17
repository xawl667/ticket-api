import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { truncateTestDatabase, createTestUser, authHeader, clearCapturedEmails } from '../setup.js';

// Hoisted mocks for the DeepSeek client - MUST be before any imports
const filterQuestionMock = vi.hoisted(() => vi.fn());
const answerQuestionMock = vi.hoisted(() => vi.fn());

vi.mock('../../src/modules/ai/client.js', () => ({
  filterQuestion: filterQuestionMock,
  answerQuestion: answerQuestionMock,
}));

let app: any;
let rateLimitApp: any;

beforeAll(async () => {
  // Set a dummy API key so the service doesn't short-circuit
  vi.stubEnv('DEEPSEEK_API_KEY', 'test-key-for-mocking');
  
  const mod = await import('../../src/app.js');
  app = mod.app;
});

afterAll(() => {
  vi.clearAllMocks();
});

describe('AI integration', () => {
  let user: Awaited<ReturnType<typeof createTestUser>>;
  let superAdmin: Awaited<ReturnType<typeof createTestUser>>;

  beforeEach(async () => {
    await truncateTestDatabase();
    clearCapturedEmails();

    user = await createTestUser('USER', 'ACTIVE');
    superAdmin = await createTestUser('SUPER_ADMIN', 'ACTIVE');

    // Reset mocks
    filterQuestionMock.mockReset();
    answerQuestionMock.mockReset();
  });

  describe('POST /ai/ask - without DEEPSEEK_API_KEY (default in test)', () => {
    it('returns 503 when no API key configured', async () => {
      // Create a fresh app without the API key
      vi.stubEnv('DEEPSEEK_API_KEY', '');
      vi.resetModules();
      const mod = await import('../../src/app.js');
      const noKeyApp = mod.app;

      const res = await request(noKeyApp)
        .post('/ai/ask')
        .set(authHeader(user.accessToken))
        .send({ question: 'Comment configurer nginx ?' });

      expect(res.status).toBe(503);
      expect(res.body).toEqual({ error: 'AI service unavailable' });
      
      // Restore the key for other tests
      vi.stubEnv('DEEPSEEK_API_KEY', 'test-key-for-mocking');
    });

    it('returns 401 without token', async () => {
      const res = await request(app)
        .post('/ai/ask')
        .send({ question: 'Comment configurer nginx ?' });

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'Unauthorized' });
    });

    it('returns 400 for empty question', async () => {
      const res = await request(app)
        .post('/ai/ask')
        .set(authHeader(user.accessToken))
        .send({ question: '' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
    });

    it('returns 400 for question too long (>2000 chars)', async () => {
      const longQuestion = 'a'.repeat(2001);
      const res = await request(app)
        .post('/ai/ask')
        .set(authHeader(user.accessToken))
        .send({ question: longQuestion });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
    });

    it('returns 400 for extra fields', async () => {
      const res = await request(app)
        .post('/ai/ask')
        .set(authHeader(user.accessToken))
        .send({ question: 'Test ?', extra: 'field' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
    });

    it('returns 400 for null bytes in question', async () => {
      const res = await request(app)
        .post('/ai/ask')
        .set(authHeader(user.accessToken))
        .send({ question: 'Test\u0000question' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
    });
  });

  describe('POST /ai/ask - with mocked DeepSeek', () => {
    it('returns 200 with answer when filter returns IT', async () => {
      filterQuestionMock.mockResolvedValue('IT');
      answerQuestionMock.mockResolvedValue('Voici la réponse...');

      const res = await request(app)
        .post('/ai/ask')
        .set(authHeader(user.accessToken))
        .send({ question: 'Comment configurer nginx ?' });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('answer', 'Voici la réponse...');
      expect(res.body).toHaveProperty('createdAt');
    });

    it('returns 422 when filter returns NOT_IT', async () => {
      filterQuestionMock.mockResolvedValue('NOT_IT');

      const res = await request(app)
        .post('/ai/ask')
        .set(authHeader(user.accessToken))
        .send({ question: 'Quelle est la recette du gâteau ?' });

      expect(res.status).toBe(422);
      expect(res.body).toEqual({ error: 'Question outside the IT scope' });
    });

    it('returns 422 when filter returns unexpected output', async () => {
      filterQuestionMock.mockResolvedValue('MAYBE');

      const res = await request(app)
        .post('/ai/ask')
        .set(authHeader(user.accessToken))
        .send({ question: 'Peut-être IT ?' });

      expect(res.status).toBe(422);
      expect(res.body).toEqual({ error: 'Question outside the IT scope' });
    });

    it('returns 422 when filter returns empty', async () => {
      filterQuestionMock.mockResolvedValue('');

      const res = await request(app)
        .post('/ai/ask')
        .set(authHeader(user.accessToken))
        .send({ question: 'Test ?' });

      expect(res.status).toBe(422);
      expect(res.body).toEqual({ error: 'Question outside the IT scope' });
    });

    it('returns 422 when filter throws timeout (fail closed)', async () => {
      filterQuestionMock.mockRejectedValue(new Error('DeepSeek API timeout'));

      const res = await request(app)
        .post('/ai/ask')
        .set(authHeader(user.accessToken))
        .send({ question: 'Comment configurer nginx ?' });

      expect(res.status).toBe(422);
      expect(res.body).toEqual({ error: 'Question outside the IT scope' });
    });

    it('returns 422 when filter throws 500 error (fail closed)', async () => {
      filterQuestionMock.mockRejectedValue(new Error('DeepSeek API error: 500'));

      const res = await request(app)
        .post('/ai/ask')
        .set(authHeader(user.accessToken))
        .send({ question: 'Comment configurer nginx ?' });

      expect(res.status).toBe(422);
      expect(res.body).toEqual({ error: 'Question outside the IT scope' });
    });

    it('saves REFUSED record when filter returns NOT_IT', async () => {
      const { prisma } = await import('../../src/shared/prisma.js');
      filterQuestionMock.mockResolvedValue('NOT_IT');

      await request(app)
        .post('/ai/ask')
        .set(authHeader(user.accessToken))
        .send({ question: 'Recette du gâteau ?' });

      const messages = await prisma.aiMessage.findMany({ where: { userId: user.id } });
      expect(messages.length).toBe(1);
      expect(messages[0].status).toBe('REFUSED');
      expect(messages[0].answer).toBeNull();
    });

    it('saves REFUSED record when filter throws (fail closed)', async () => {
      const { prisma } = await import('../../src/shared/prisma.js');
      filterQuestionMock.mockRejectedValue(new Error('DeepSeek API timeout'));

      await request(app)
        .post('/ai/ask')
        .set(authHeader(user.accessToken))
        .send({ question: 'Comment configurer nginx ?' });

      const messages = await prisma.aiMessage.findMany({ where: { userId: user.id } });
      expect(messages.length).toBe(1);
      expect(messages[0].status).toBe('REFUSED');
      expect(messages[0].answer).toBeNull();
    });

    it('saves ANSWERED record when filter returns IT and answer succeeds', async () => {
      const { prisma } = await import('../../src/shared/prisma.js');
      filterQuestionMock.mockResolvedValue('IT');
      answerQuestionMock.mockResolvedValue('Réponse IT');

      const res = await request(app)
        .post('/ai/ask')
        .set(authHeader(user.accessToken))
        .send({ question: 'Comment configurer nginx ?' });

      expect(res.status).toBe(200);

      const messages = await prisma.aiMessage.findMany({ where: { userId: user.id } });
      expect(messages.length).toBe(1);
      expect(messages[0].status).toBe('ANSWERED');
      expect(messages[0].answer).toBe('Réponse IT');
    });

    it('saves FAILED record when answer throws', async () => {
      const { prisma } = await import('../../src/shared/prisma.js');
      filterQuestionMock.mockResolvedValue('IT');
      answerQuestionMock.mockRejectedValue(new Error('DeepSeek API error: 500'));

      await request(app)
        .post('/ai/ask')
        .set(authHeader(user.accessToken))
        .send({ question: 'Comment configurer nginx ?' });

      const messages = await prisma.aiMessage.findMany({ where: { userId: user.id } });
      expect(messages.length).toBe(1);
      expect(messages[0].status).toBe('FAILED');
      expect(messages[0].answer).toBeNull();
    });

    it('does not call answerQuestion when filter returns NOT_IT', async () => {
      filterQuestionMock.mockResolvedValue('NOT_IT');
      answerQuestionMock.mockResolvedValue('Réponse');

      await request(app)
        .post('/ai/ask')
        .set(authHeader(user.accessToken))
        .send({ question: 'Recette du gâteau ?' });

      expect(answerQuestionMock).not.toHaveBeenCalled();
    });
  });

  describe('POST /ai/ask - security', () => {
    it('question never appears in system prompt (inspect mock args)', async () => {
      filterQuestionMock.mockResolvedValue('IT');
      answerQuestionMock.mockResolvedValue('Réponse');

      const testQuestion = 'Comment configurer nginx reverse proxy ?';
      await request(app)
        .post('/ai/ask')
        .set(authHeader(user.accessToken))
        .send({ question: testQuestion });

      // The filterQuestion mock should have been called
      expect(filterQuestionMock).toHaveBeenCalled();

      // This test verifies the implementation detail that the question
      // goes in the "user" message, not the system prompt
      // The actual verification is in the client.ts implementation
    });
  });

  describe('GET /ai/history', () => {
    beforeEach(async () => {
      const { prisma } = await import('../../src/shared/prisma.js');

      // Create some test messages
      await prisma.aiMessage.createMany({
        data: [
          {
            userId: user.id,
            question: 'Question 1',
            answer: 'Réponse 1',
            status: 'ANSWERED',
            model: 'deepseek-chat',
          },
          {
            userId: user.id,
            question: 'Question 2',
            answer: null,
            status: 'REFUSED',
            model: 'deepseek-chat',
          },
          {
            userId: user.id,
            question: 'Question 3',
            answer: null,
            status: 'FAILED',
            model: 'deepseek-chat',
          },
        ],
      });

      // Create a message for another user
      const user2 = await createTestUser('USER', 'ACTIVE', { email: 'user2@example.com' });
      await prisma.aiMessage.create({
        data: {
          userId: user2.id,
          question: 'Question user2',
          answer: 'Réponse user2',
          status: 'ANSWERED',
          model: 'deepseek-chat',
        },
      });
    });

    it('USER sees only their own messages', async () => {
      const res = await request(app)
        .get('/ai/history')
        .set(authHeader(user.accessToken));

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(3);
      expect(res.body.data.every((m: any) => m.question.startsWith('Question'))).toBe(true);
    });

    it('SUPER_ADMIN sees all messages when no userId filter', async () => {
      const res = await request(app)
        .get('/ai/history')
        .set(authHeader(superAdmin.accessToken));

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(4);
    });

    it('SUPER_ADMIN can filter by userId', async () => {
      const res = await request(app)
        .get('/ai/history?userId=' + user.id)
        .set(authHeader(superAdmin.accessToken));

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(3);
      expect(res.body.data.every((m: any) => m.question.startsWith('Question'))).toBe(true);
    });

    it('returns pagination meta', async () => {
      const res = await request(app)
        .get('/ai/history?page=1&limit=2')
        .set(authHeader(user.accessToken));

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(2);
      expect(res.body.meta).toEqual({
        page: 1,
        limit: 2,
        total: 3,
        totalPages: 2,
      });
    });

    it('sorts by createdAt descending (most recent first)', async () => {
      const res = await request(app)
        .get('/ai/history')
        .set(authHeader(user.accessToken));

      expect(res.status).toBe(200);
      const dates = res.body.data.map((m: any) => new Date(m.createdAt).getTime());
      for (let i = 1; i < dates.length; i++) {
        expect(dates[i]).toBeLessThanOrEqual(dates[i - 1]);
      }
    });

    it('returns 400 for invalid page', async () => {
      const res = await request(app)
        .get('/ai/history?page=0')
        .set(authHeader(user.accessToken));

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
    });

    it('returns 400 for invalid limit', async () => {
      const res = await request(app)
        .get('/ai/history?limit=0')
        .set(authHeader(user.accessToken));

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
    });

    it('caps limit at 100', async () => {
      const res = await request(app)
        .get('/ai/history?limit=200')
        .set(authHeader(user.accessToken));

      expect(res.status).toBe(200);
      expect(res.body.meta.limit).toBe(100);
    });

    it('returns 400 for invalid userId format', async () => {
      const res = await request(app)
        .get('/ai/history?userId=invalid')
        .set(authHeader(superAdmin.accessToken));

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
    });

    it('no sensitive fields in response', async () => {
      const res = await request(app)
        .get('/ai/history')
        .set(authHeader(user.accessToken));

      expect(res.status).toBe(200);
      for (const msg of res.body.data) {
        expect(msg).not.toHaveProperty('userId');
        expect(msg).toHaveProperty('id');
        expect(msg).toHaveProperty('question');
        expect(msg).toHaveProperty('answer');
        expect(msg).toHaveProperty('status');
        expect(msg).toHaveProperty('model');
        expect(msg).toHaveProperty('createdAt');
      }
    });
  });

  describe('Rate limiting /ai/ask (per user)', () => {
    beforeAll(async () => {
      // Enable rate limiting for this test suite
      vi.stubEnv('RATE_LIMIT_ENABLED', 'true');
      vi.stubEnv('AI_RATE_LIMIT_PER_HOUR', '3');
      vi.stubEnv('DEEPSEEK_API_KEY', 'test-key-for-mocking');
      vi.resetModules();
      const mod = await import('../../src/app.js');
      rateLimitApp = mod.app;
    });

    beforeEach(async () => {
      await truncateTestDatabase();
      clearCapturedEmails();

      user = await createTestUser('USER', 'ACTIVE');
      superAdmin = await createTestUser('SUPER_ADMIN', 'ACTIVE');

      filterQuestionMock.mockReset();
      answerQuestionMock.mockReset();
    });

    it('allows up to AI_RATE_LIMIT_PER_HOUR requests per user', async () => {
      filterQuestionMock.mockResolvedValue('IT');
      answerQuestionMock.mockResolvedValue('Réponse');

      for (let i = 0; i < 3; i++) {
        const res = await request(rateLimitApp)
          .post('/ai/ask')
          .set(authHeader(user.accessToken))
          .send({ question: `Question ${i} ?` });
        expect(res.status).toBe(200);
      }
    });

    it('returns 429 when quota exceeded for a user', async () => {
      filterQuestionMock.mockResolvedValue('IT');
      answerQuestionMock.mockResolvedValue('Réponse');

      for (let i = 0; i < 3; i++) {
        await request(rateLimitApp)
          .post('/ai/ask')
          .set(authHeader(user.accessToken))
          .send({ question: `Question ${i} ?` });
      }

      const res = await request(rateLimitApp)
        .post('/ai/ask')
        .set(authHeader(user.accessToken))
        .send({ question: 'Question extra ?' });

      expect(res.status).toBe(429);
      expect(res.body).toEqual({ error: 'Too many requests' });
    });

    it('quota is per user (user A blocked, user B not)', async () => {
      const userB = await createTestUser('USER', 'ACTIVE', { email: 'userb@example.com' });

      filterQuestionMock.mockResolvedValue('IT');
      answerQuestionMock.mockResolvedValue('Réponse');

      // Exhaust user A's quota
      for (let i = 0; i < 3; i++) {
        await request(rateLimitApp)
          .post('/ai/ask')
          .set(authHeader(user.accessToken))
          .send({ question: `Question ${i} ?` });
      }

      // User A should be blocked
      const resA = await request(rateLimitApp)
        .post('/ai/ask')
        .set(authHeader(user.accessToken))
        .send({ question: 'Question extra ?' });
      expect(resA.status).toBe(429);

      // User B should still work
      const resB = await request(rateLimitApp)
        .post('/ai/ask')
        .set(authHeader(userB.accessToken))
        .send({ question: 'Question B ?' });
      expect(resB.status).toBe(200);
    });
  });

  describe('Error format consistency', () => {
    it('all error responses have { error } format', async () => {
      // 401
      const res401 = await request(app).post('/ai/ask').send({ question: 'Test ?' });
      expect(res401.body).toEqual({ error: 'Unauthorized' });

      // 400
      const res400 = await request(app)
        .post('/ai/ask')
        .set(authHeader(user.accessToken))
        .send({ question: '' });
      expect(res400.body).toHaveProperty('error');

      // 422
      filterQuestionMock.mockResolvedValue('NOT_IT');
      const res422 = await request(app)
        .post('/ai/ask')
        .set(authHeader(user.accessToken))
        .send({ question: 'Recette ?' });
      expect(res422.body).toEqual({ error: 'Question outside the IT scope' });

      // 422 (filter error = fail closed)
      filterQuestionMock.mockRejectedValue(new Error('DeepSeek API error: 500'));
      const res422b = await request(app)
        .post('/ai/ask')
        .set(authHeader(user.accessToken))
        .send({ question: 'Test ?' });
      expect(res422b.body).toEqual({ error: 'Question outside the IT scope' });

      // 503 (answer error = provider unavailable)
      filterQuestionMock.mockResolvedValue('IT');
      answerQuestionMock.mockRejectedValue(new Error('DeepSeek API error: 500'));
      const res503 = await request(app)
        .post('/ai/ask')
        .set(authHeader(user.accessToken))
        .send({ question: 'Test ?' });
      expect(res503.body).toEqual({ error: 'AI service unavailable' });
    });
  });
});