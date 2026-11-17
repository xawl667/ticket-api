import { vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHash, randomBytes, randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// CRITICAL: Load .env.test BEFORE any src imports
// This setup file runs first via vitest config setupFiles
// ============================================================================
dotenv.config({ path: path.resolve(__dirname, '../.env.test'), override: true });

// ============================================================================
// GARDE-FOU: Refuse to run if DATABASE_URL doesn't end with _test
// ============================================================================
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl || !dbUrl.endsWith('_test')) {
  const msg = `REFUS: DATABASE_URL doit finir par "_test". Actuel: ${dbUrl ?? 'non défini'}`;
  console.error(msg);
  throw new Error(msg);
}

console.log('[TEST SETUP] Database URL validated:', dbUrl);
console.log('[TEST SETUP] JWT_SECRET:', process.env.JWT_SECRET?.slice(0, 10) + '...');
console.log('[TEST SETUP] RATE_LIMIT_ENABLED:', process.env.RATE_LIMIT_ENABLED);
console.log('[TEST SETUP] NODE_ENV:', process.env.NODE_ENV);

// ============================================================================
// Shared captured emails array (shared across test files via module singleton)
// ============================================================================
export const capturedEmails: Array<{ to: string; subject: string; text: string }> = [];

// Mock sendEmail at module level so it's hoisted before any imports
vi.mock('../src/shared/email.js', () => ({
  sendEmail: vi.fn(async (params: { to: string; subject: string; text: string }) => {
    capturedEmails.push(params);
    console.log('[MOCK EMAIL]', { to: params.to, subject: params.subject });
  }),
}));

export function clearCapturedEmails() {
  capturedEmails.length = 0;
}

export function getLastInvitationToken(): string | null {
  const email = capturedEmails.find(e => e.subject.includes('Invitation'));
  if (!email) return null;
  const match = email.text.match(/token=([^&\s]+)/);
  return match ? match[1] : null;
}

export function getLastResetToken(): string | null {
  const email = capturedEmails.find(e => e.subject.includes('Password Reset'));
  if (!email) return null;
  const match = email.text.match(/token=([^&\s]+)/);
  return match ? match[1] : null;
}

// ============================================================================
// JWT helpers for tests (using same secret as app will use)
// ============================================================================
const TEST_JWT_SECRET = process.env.JWT_SECRET!;
const TEST_JWT_ISSUER = process.env.JWT_ISSUER!;
const TEST_JWT_AUDIENCE = process.env.JWT_AUDIENCE!;

export function signTestAccessToken(payload: { sub: string; role: string; sid?: string }): string {
  return jwt.sign({ ...payload, sid: payload.sid ?? randomUUID() }, TEST_JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '15m',
    issuer: TEST_JWT_ISSUER,
    audience: TEST_JWT_AUDIENCE,
  });
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function generateRefreshToken(): string {
  return randomBytes(32).toString('hex');
}

function getRefreshTokenExpiry(): Date {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
}

// ============================================================================
// Prisma client - SINGLE shared instance (src/shared/prisma.ts)
// ============================================================================
let prisma: any = null;

export async function getPrisma() {
  if (!prisma) {
    const { prisma: appPrisma } = await import('../src/shared/prisma.js');
    prisma = appPrisma;
  }
  return prisma;
}

// ============================================================================
// Test database cleanup helpers
// ============================================================================
export async function truncateTestDatabase() {
  const p = await getPrisma();
  await p.auditLog?.deleteMany?.().catch(() => {});
  await p.refreshToken.deleteMany();
  await p.userToken.deleteMany();
  await p.ticket.deleteMany();
  await p.user.deleteMany();
}

beforeAll(async () => {
  await truncateTestDatabase();
});

afterAll(async () => {
  await truncateTestDatabase();
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
  }
});

beforeEach(() => {
  clearCapturedEmails();
});

// ============================================================================
// Test helpers
// ============================================================================
export interface TestUser {
  id: string;
  email: string;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'AGENT' | 'USER';
  status: 'ACTIVE' | 'INVITED' | 'DISABLED';
  passwordHash: string;
  accessToken: string;
  refreshToken?: string;
}

export async function createTestUser(
  role: 'SUPER_ADMIN' | 'ADMIN' | 'AGENT' | 'USER' = 'USER',
  status: 'ACTIVE' | 'INVITED' | 'DISABLED' = 'ACTIVE',
  overrides: Partial<{ email: string; password: string }> = {}
): Promise<TestUser> {
  const p = await getPrisma();
  
  const email = overrides.email ?? `test-${role.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = overrides.password ?? 'TestPass123!';
  const passwordHash = await bcrypt.hash(password, 12);

  const user = await p.user.create({
    data: {
      email,
      passwordHash,
      role,
      status,
    },
  });

  // Create a refresh token family for session binding
  const familyId = randomUUID();
  const refreshToken = generateRefreshToken();
  const refreshTokenHash = hashToken(refreshToken);
  const expiresAt = getRefreshTokenExpiry();

  await p.refreshToken.create({
    data: {
      tokenHash: refreshTokenHash,
      userId: user.id,
      familyId,
      expiresAt,
    },
  });

  const accessToken = signTestAccessToken({ sub: user.id, role: user.role, sid: familyId });

  return {
    id: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
    passwordHash,
    accessToken,
    refreshToken,
  };
}

export async function createTestUserWithRefreshToken(
  role: 'SUPER_ADMIN' | 'ADMIN' | 'AGENT' | 'USER' = 'USER',
  status: 'ACTIVE' | 'INVITED' | 'DISABLED' = 'ACTIVE',
  overrides: Partial<{ email: string; password: string }> = {}
): Promise<TestUser> {
  const p = await getPrisma();
  
  const email = overrides.email ?? `test-${role.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = overrides.password ?? 'TestPass123!';
  const passwordHash = await bcrypt.hash(password, 12);

  const user = await p.user.create({
    data: {
      email,
      passwordHash,
      role,
      status,
    },
  });

  const familyId = randomUUID();
  const refreshToken = generateRefreshToken();
  const refreshTokenHash = hashToken(refreshToken);
  const expiresAt = getRefreshTokenExpiry();

  await p.refreshToken.create({
    data: {
      tokenHash: refreshTokenHash,
      userId: user.id,
      familyId,
      expiresAt,
    },
  });

  const accessToken = signTestAccessToken({ sub: user.id, role: user.role, sid: familyId });

  return {
    id: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
    passwordHash,
    accessToken,
    refreshToken,
  };
}

export function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

// ============================================================================
// Test to verify garde-fou works
// ============================================================================
import { describe, it, expect } from 'vitest';

describe('Test setup garde-fou', () => {
  it('DATABASE_URL ends with _test', () => {
    expect(process.env.DATABASE_URL).toMatch(/_test$/);
  });

  it('NODE_ENV is test', () => {
    expect(process.env.NODE_ENV).toBe('test');
  });

  it('RATE_LIMIT_ENABLED is set', () => {
    // Can be 'true' (rate-limit test) or 'false' (default)
    expect(['true', 'false']).toContain(process.env.RATE_LIMIT_ENABLED);
  });

  it('JWT_SECRET is at least 32 chars', () => {
    expect(process.env.JWT_SECRET!.length).toBeGreaterThanOrEqual(32);
  });

  it('sendEmail mock is installed', async () => {
    const { sendEmail } = await import('../src/shared/email.js');
    await sendEmail({ to: 'test@test.com', subject: 'Test', text: 'body' });
    expect(capturedEmails.length).toBe(1);
    expect(capturedEmails[0].to).toBe('test@test.com');
  });
});