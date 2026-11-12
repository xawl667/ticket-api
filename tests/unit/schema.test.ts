import { describe, it, expect, vi } from 'vitest';

describe('shared/schema (Zod)', () => {
  let createTicketSchema: any;
  let updateStatusSchema: any;
  let listQuerySchema: any;
  let loginSchema: any;
  let acceptInvitationSchema: any;
  let forgotPasswordSchema: any;
  let resetPasswordSchema: any;
  let createUserSchema: any;
  let updateUserStatusSchema: any;
  let statusSchema: any;

  beforeEach(async () => {
    vi.resetModules();
    const schema = await import('../../src/shared/schema.js');
    createTicketSchema = schema.createTicketSchema;
    updateStatusSchema = schema.updateStatusSchema;
    listQuerySchema = schema.listQuerySchema;
    loginSchema = schema.loginSchema;
    acceptInvitationSchema = schema.acceptInvitationSchema;
    forgotPasswordSchema = schema.forgotPasswordSchema;
    resetPasswordSchema = schema.resetPasswordSchema;
    createUserSchema = schema.createUserSchema;
    updateUserStatusSchema = schema.updateUserStatusSchema;
    statusSchema = schema.statusSchema;
  });

  describe('createTicketSchema', () => {
    it('accepts valid title and description', () => {
      const result = createTicketSchema.safeParse({ title: 'Bug', description: 'Details' });
      expect(result.success).toBe(true);
    });

    it('rejects empty title', () => {
      const result = createTicketSchema.safeParse({ title: '', description: 'x' });
      expect(result.success).toBe(false);
    });

    it('rejects title > 200 chars', () => {
      const result = createTicketSchema.safeParse({ title: 'x'.repeat(201), description: 'x' });
      expect(result.success).toBe(false);
    });

    it('rejects empty description', () => {
      const result = createTicketSchema.safeParse({ title: 'x', description: '' });
      expect(result.success).toBe(false);
    });

    it('rejects extra fields (.strict)', () => {
      const result = createTicketSchema.safeParse({ title: 'x', description: 'x', extra: 'field' });
      expect(result.success).toBe(false);
    });

    it('rejects null bytes in title', () => {
      const result = createTicketSchema.safeParse({ title: 'test\x00', description: 'x' });
      expect(result.success).toBe(false);
    });

    it('rejects null bytes in description', () => {
      const result = createTicketSchema.safeParse({ title: 'x', description: 'test\x00' });
      expect(result.success).toBe(false);
    });
  });

  describe('updateStatusSchema', () => {
    it('accepts valid status', () => {
      for (const s of ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']) {
        expect(updateStatusSchema.safeParse({ status: s }).success).toBe(true);
      }
    });

    it('rejects invalid status', () => {
      const result = updateStatusSchema.safeParse({ status: 'INVALID' });
      expect(result.success).toBe(false);
    });

    it('rejects extra fields', () => {
      const result = updateStatusSchema.safeParse({ status: 'OPEN', extra: 1 });
      expect(result.success).toBe(false);
    });
  });

  describe('listQuerySchema', () => {
    it('accepts empty query', () => {
      expect(listQuerySchema.safeParse({}).success).toBe(true);
    });

    it('accepts valid status filter', () => {
      expect(listQuerySchema.safeParse({ status: 'OPEN' }).success).toBe(true);
    });

    it('rejects invalid status', () => {
      expect(listQuerySchema.safeParse({ status: 'FOO' }).success).toBe(false);
    });

    it('rejects extra fields', () => {
      expect(listQuerySchema.safeParse({ status: 'OPEN', extra: 1 }).success).toBe(false);
    });
  });

  describe('loginSchema', () => {
    it('accepts valid email and password', () => {
      const result = loginSchema.safeParse({ email: 'user@example.com', password: 'password123' });
      expect(result.success).toBe(true);
    });

    it('lowercases email', () => {
      const result = loginSchema.safeParse({ email: 'USER@EXAMPLE.COM', password: 'x' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.email).toBe('user@example.com');
    });

    it('rejects invalid email', () => {
      expect(loginSchema.safeParse({ email: 'not-email', password: 'x' }).success).toBe(false);
    });

    it('rejects empty password', () => {
      expect(loginSchema.safeParse({ email: 'x@y.z', password: '' }).success).toBe(false);
    });

    it('rejects password > 128 chars', () => {
      expect(loginSchema.safeParse({ email: 'x@y.z', password: 'x'.repeat(129) }).success).toBe(false);
    });

    it('rejects extra fields', () => {
      expect(loginSchema.safeParse({ email: 'x@y.z', password: 'x', role: 'ADMIN' }).success).toBe(false);
    });

    it('rejects null bytes in email', () => {
      const result = loginSchema.safeParse({ email: 'user\x00@example.com', password: 'x' });
      expect(result.success).toBe(false);
    });

    it('rejects null bytes in password', () => {
      const result = loginSchema.safeParse({ email: 'x@y.z', password: 'pass\x00' });
      expect(result.success).toBe(false);
    });
  });

  describe('acceptInvitationSchema', () => {
    it('accepts valid token and password >= 12', () => {
      expect(acceptInvitationSchema.safeParse({ token: 'abc', password: 'ValidPass123!' }).success).toBe(true);
    });

    it('rejects password < 12', () => {
      expect(acceptInvitationSchema.safeParse({ token: 'abc', password: 'short' }).success).toBe(false);
    });

    it('rejects password > 72 (bcrypt limit)', () => {
      expect(acceptInvitationSchema.safeParse({ token: 'abc', password: 'x'.repeat(73) }).success).toBe(false);
    });

    it('rejects extra fields', () => {
      expect(acceptInvitationSchema.safeParse({ token: 'abc', password: 'ValidPass123!', extra: 1 }).success).toBe(false);
    });

    it('rejects null bytes in token', () => {
      const result = acceptInvitationSchema.safeParse({ token: 'abc\x00', password: 'ValidPass123!' });
      expect(result.success).toBe(false);
    });

    it('rejects null bytes in password', () => {
      const result = acceptInvitationSchema.safeParse({ token: 'abc', password: 'ValidPass\x00!' });
      expect(result.success).toBe(false);
    });
  });

  describe('forgotPasswordSchema', () => {
    it('accepts valid email', () => {
      expect(forgotPasswordSchema.safeParse({ email: 'user@example.com' }).success).toBe(true);
    });

    it('lowercases email', () => {
      const result = forgotPasswordSchema.safeParse({ email: 'USER@EXAMPLE.COM' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.email).toBe('user@example.com');
    });

    it('rejects invalid email', () => {
      expect(forgotPasswordSchema.safeParse({ email: 'not-email' }).success).toBe(false);
    });

    it('rejects extra fields', () => {
      expect(forgotPasswordSchema.safeParse({ email: 'x@y.z', extra: 1 }).success).toBe(false);
    });

    it('rejects null bytes in email', () => {
      const result = forgotPasswordSchema.safeParse({ email: 'user\x00@example.com' });
      expect(result.success).toBe(false);
    });
  });

  describe('resetPasswordSchema', () => {
    it('accepts valid token and password 12-72', () => {
      expect(resetPasswordSchema.safeParse({ token: 'abc', password: 'ValidPass123!' }).success).toBe(true);
    });

    it('rejects password < 12', () => {
      expect(resetPasswordSchema.safeParse({ token: 'abc', password: 'short' }).success).toBe(false);
    });

    it('rejects password > 72', () => {
      expect(resetPasswordSchema.safeParse({ token: 'abc', password: 'x'.repeat(73) }).success).toBe(false);
    });

    it('rejects extra fields', () => {
      expect(resetPasswordSchema.safeParse({ token: 'abc', password: 'ValidPass123!', extra: 1 }).success).toBe(false);
    });

    it('rejects null bytes in token', () => {
      const result = resetPasswordSchema.safeParse({ token: 'abc\x00', password: 'ValidPass123!' });
      expect(result.success).toBe(false);
    });

    it('rejects null bytes in password', () => {
      const result = resetPasswordSchema.safeParse({ token: 'abc', password: 'ValidPass\x00!' });
      expect(result.success).toBe(false);
    });
  });

  describe('createUserSchema', () => {
    it('accepts email only (role defaults to USER)', () => {
      const result = createUserSchema.safeParse({ email: 'new@example.com' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.role).toBe('USER');
    });

    it('accepts valid role', () => {
      for (const r of ['ADMIN', 'AGENT', 'USER']) {
        const result = createUserSchema.safeParse({ email: 'x@example.com', role: r });
        console.log('[DEBUG createUserSchema]', r, result.success, result.error?.issues);
        expect(result.success).toBe(true);
      }
    });

    it('rejects SUPER_ADMIN role', () => {
      expect(createUserSchema.safeParse({ email: 'x@y.z', role: 'SUPER_ADMIN' }).success).toBe(false);
    });

    it('rejects invalid role', () => {
      expect(createUserSchema.safeParse({ email: 'x@y.z', role: 'FOO' }).success).toBe(false);
    });

    it('lowercases email', () => {
      const result = createUserSchema.safeParse({ email: 'USER@EXAMPLE.COM' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.email).toBe('user@example.com');
    });

    it('rejects extra fields', () => {
      expect(createUserSchema.safeParse({ email: 'x@y.z', extra: 1 }).success).toBe(false);
    });

    it('rejects null bytes in email', () => {
      const result = createUserSchema.safeParse({ email: 'user\x00@example.com' });
      expect(result.success).toBe(false);
    });
  });

  describe('updateUserStatusSchema', () => {
    it('accepts ACTIVE or DISABLED', () => {
      expect(updateUserStatusSchema.safeParse({ status: 'ACTIVE' }).success).toBe(true);
      expect(updateUserStatusSchema.safeParse({ status: 'DISABLED' }).success).toBe(true);
    });

    it('rejects INVITED', () => {
      expect(updateUserStatusSchema.safeParse({ status: 'INVITED' }).success).toBe(false);
    });

    it('rejects extra fields', () => {
      expect(updateUserStatusSchema.safeParse({ status: 'ACTIVE', extra: 1 }).success).toBe(false);
    });
  });

  describe('statusSchema (TicketStatus)', () => {
    it('accepts all 4 statuses', () => {
      for (const s of ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']) {
        expect(statusSchema.safeParse(s).success).toBe(true);
      }
    });

    it('rejects invalid', () => {
      expect(statusSchema.safeParse('FOO').success).toBe(false);
    });
  });
});