import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('config/env validation', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it('accepts valid test config', async () => {
    process.env.NODE_ENV = 'test';
    process.env.PORT = '3001';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5433/tickets_test';
    process.env.JWT_SECRET = 'test-secret-min-32-chars-abcdefghijklmnop';
    process.env.JWT_ISSUER = 'ticket-api';
    process.env.JWT_AUDIENCE = 'ticket-api';
    process.env.APP_URL = 'http://localhost:3001';
    process.env.RATE_LIMIT_ENABLED = 'false';
    vi.resetModules();
    const { env } = await import('../../src/config/env.js');
    expect(env.NODE_ENV).toBe('test');
    expect(env.PORT).toBe(3001);
    expect(env.DATABASE_URL).toBe('postgresql://user:pass@localhost:5433/tickets_test');
    expect(env.JWT_SECRET).toBe('test-secret-min-32-chars-abcdefghijklmnop');
  });

  it('rejects JWT_SECRET < 32 chars', async () => {
    process.env.JWT_SECRET = 'short';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5433/tickets_test';
    vi.resetModules();
    await expect(import('../../src/config/env.js')).rejects.toThrow();
  });

  it('rejects non-postgresql DATABASE_URL', async () => {
    process.env.DATABASE_URL = 'mysql://x';
    process.env.JWT_SECRET = 'test-secret-min-32-chars-abcdefghijklmnop';
    vi.resetModules();
    await expect(import('../../src/config/env.js')).rejects.toThrow();
  });

  it('defaults NODE_ENV to development', async () => {
    delete process.env.NODE_ENV;
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5433/tickets_test';
    process.env.JWT_SECRET = 'test-secret-min-32-chars-abcdefghijklmnop';
    vi.resetModules();
    const { env } = await import('../../src/config/env.js');
    expect(env.NODE_ENV).toBe('development');
  });

  it('defaults PORT to 3000', async () => {
    delete process.env.PORT;
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5433/tickets_test';
    process.env.JWT_SECRET = 'test-secret-min-32-chars-abcdefghijklmnop';
    vi.resetModules();
    const { env } = await import('../../src/config/env.js');
    expect(env.PORT).toBe(3000);
  });

  it('defaults JWT_ISSUER and JWT_AUDIENCE', async () => {
    delete process.env.JWT_ISSUER;
    delete process.env.JWT_AUDIENCE;
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5433/tickets_test';
    process.env.JWT_SECRET = 'test-secret-min-32-chars-abcdefghijklmnop';
    vi.resetModules();
    const { env } = await import('../../src/config/env.js');
    expect(env.JWT_ISSUER).toBe('ticket-api');
    expect(env.JWT_AUDIENCE).toBe('ticket-api');
  });

  it('defaults APP_URL and strips trailing slashes', async () => {
    process.env.APP_URL = 'https://example.com///';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5433/tickets_test';
    process.env.JWT_SECRET = 'test-secret-min-32-chars-abcdefghijklmnop';
    vi.resetModules();
    const { env } = await import('../../src/config/env.js');
    expect(env.APP_URL).toBe('https://example.com');
  });

  it('accepts valid RESEND_API_KEY', async () => {
    process.env.RESEND_API_KEY = 're_abcdefghijklmnopqrst';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5433/tickets_test';
    process.env.JWT_SECRET = 'test-secret-min-32-chars-abcdefghijklmnop';
    vi.resetModules();
    const { env } = await import('../../src/config/env.js');
    expect(env.RESEND_API_KEY).toBe('re_abcdefghijklmnopqrst');
  });

  it('rejects invalid RESEND_API_KEY format', async () => {
    process.env.RESEND_API_KEY = 'invalid';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5433/tickets_test';
    process.env.JWT_SECRET = 'test-secret-min-32-chars-abcdefghijklmnop';
    vi.resetModules();
    await expect(import('../../src/config/env.js')).rejects.toThrow();
  });

  it('treats empty RESEND_API_KEY as undefined', async () => {
    process.env.RESEND_API_KEY = '';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5433/tickets_test';
    process.env.JWT_SECRET = 'test-secret-min-32-chars-abcdefghijklmnop';
    vi.resetModules();
    const { env } = await import('../../src/config/env.js');
    expect(env.RESEND_API_KEY).toBeUndefined();
  });

  it('defaults EMAIL_FROM', async () => {
    delete process.env.EMAIL_FROM;
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5433/tickets_test';
    process.env.JWT_SECRET = 'test-secret-min-32-chars-abcdefghijklmnop';
    vi.resetModules();
    const { env } = await import('../../src/config/env.js');
    expect(env.EMAIL_FROM).toBe('onboarding@resend.dev');
  });

  it('defaults RATE_LIMIT_ENABLED to true', async () => {
    delete process.env.RATE_LIMIT_ENABLED;
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5433/tickets_test';
    process.env.JWT_SECRET = 'test-secret-min-32-chars-abcdefghijklmnop';
    vi.resetModules();
    const { env } = await import('../../src/config/env.js');
    expect(env.RATE_LIMIT_ENABLED).toBe(true);
  });

  it('coerces RATE_LIMIT_ENABLED from string "false" to boolean false', async () => {
    process.env.RATE_LIMIT_ENABLED = 'false';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5433/tickets_test';
    process.env.JWT_SECRET = 'test-secret-min-32-chars-abcdefghijklmnop';
    vi.resetModules();
    const { env } = await import('../../src/config/env.js');
    expect(env.RATE_LIMIT_ENABLED).toBe(false);
  });

  it('coerces RATE_LIMIT_ENABLED from string "true" to boolean true', async () => {
    process.env.RATE_LIMIT_ENABLED = 'true';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5433/tickets_test';
    process.env.JWT_SECRET = 'test-secret-min-32-chars-abcdefghijklmnop';
    vi.resetModules();
    const { env } = await import('../../src/config/env.js');
    expect(env.RATE_LIMIT_ENABLED).toBe(true);
  });

  it('validates SEED_SUPER_ADMIN_PASSWORD min 12', async () => {
    process.env.SEED_SUPER_ADMIN_PASSWORD = 'short';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5433/tickets_test';
    process.env.JWT_SECRET = 'test-secret-min-32-chars-abcdefghijklmnop';
    vi.resetModules();
    await expect(import('../../src/config/env.js')).rejects.toThrow();
  });

  it('production requires RESEND_API_KEY and https APP_URL', async () => {
    process.env.NODE_ENV = 'production';
    process.env.RESEND_API_KEY = 're_abcdefghijklmnopqrst';
    process.env.APP_URL = 'https://example.com';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5433/tickets_test';
    process.env.JWT_SECRET = 'test-secret-min-32-chars-abcdefghijklmnop';
    vi.resetModules();
    const { env } = await import('../../src/config/env.js');
    expect(env.NODE_ENV).toBe('production');
    expect(env.RESEND_API_KEY).toBe('re_abcdefghijklmnopqrst');
    expect(env.APP_URL).toBe('https://example.com');
  });
});