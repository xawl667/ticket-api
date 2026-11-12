import { describe, it, expect, vi } from 'vitest';

// This test verifies the garde-fou in setup.ts works correctly
// It runs in a separate process context to test the validation

describe('Test setup garde-fou', () => {
  it('DATABASE_URL ends with _test in test environment', () => {
    const dbUrl = process.env.DATABASE_URL;
    expect(dbUrl).toBeDefined();
    expect(dbUrl).toMatch(/_test$/);
  });

  it('NODE_ENV is test', () => {
    expect(process.env.NODE_ENV).toBe('test');
  });

  it('RATE_LIMIT_ENABLED is false by default', () => {
    expect(process.env.RATE_LIMIT_ENABLED).toBe('false');
  });

  it('JWT_SECRET is at least 32 chars', () => {
    expect(process.env.JWT_SECRET).toBeDefined();
    expect(process.env.JWT_SECRET!.length).toBeGreaterThanOrEqual(32);
  });
});