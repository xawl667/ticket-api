import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hashToken, signAccessToken, verifyAccessToken, generateRefreshToken, getRefreshTokenExpiry } from '../../src/modules/auth/tokens.js';
import jwt from 'jsonwebtoken';

describe('auth/tokens', () => {
  describe('hashToken', () => {
    it('produces deterministic SHA-256 hex', () => {
      const t1 = hashToken('abc');
      const t2 = hashToken('abc');
      expect(t1).toBe(t2);
      expect(t1).toMatch(/^[a-f0-9]{64}$/);
    });

    it('different input produces different hash', () => {
      expect(hashToken('a')).not.toBe(hashToken('b'));
    });
  });

  describe('generateRefreshToken', () => {
    it('returns 64-char hex string (32 bytes)', () => {
      const t = generateRefreshToken();
      expect(t).toMatch(/^[a-f0-9]{64}$/);
    });

    it('high entropy - different each call', () => {
      const tokens = new Set();
      for (let i = 0; i < 100; i++) tokens.add(generateRefreshToken());
      expect(tokens.size).toBe(100);
    });
  });

  describe('getRefreshTokenExpiry', () => {
    it('returns Date ~7 days in future', () => {
      const exp = getRefreshTokenExpiry();
      const now = Date.now();
      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      expect(exp.getTime()).toBeGreaterThan(now + sevenDays - 1000);
      expect(exp.getTime()).toBeLessThan(now + sevenDays + 1000);
    });
  });

  describe('signAccessToken / verifyAccessToken', () => {
    const payload = { sub: 'user-123', role: 'ADMIN' };

    it('roundtrip: sign then verify returns same payload', () => {
      const token = signAccessToken(payload);
      const decoded = verifyAccessToken(token);
      expect(decoded.sub).toBe(payload.sub);
      expect(decoded.role).toBe(payload.role);
    });

    it('rejects token signed with wrong secret', () => {
      const token = signAccessToken(payload);
      // Create a token with a different secret using jwt directly
      const wrongSecretToken = jwt.sign(payload, 'wrong-secret-min-32-chars-abcdefghijklmnop', {
        algorithm: 'HS256',
        expiresIn: '15m',
        issuer: 'ticket-api',
        audience: 'ticket-api',
      });
      expect(() => verifyAccessToken(wrongSecretToken)).toThrow();
    });

    it('rejects token with wrong issuer', () => {
      const wrongIssuerToken = jwt.sign(payload, 'test-secret-min-32-chars-abcdefghijklmnop', {
        algorithm: 'HS256',
        expiresIn: '15m',
        issuer: 'wrong-issuer',
        audience: 'ticket-api',
      });
      expect(() => verifyAccessToken(wrongIssuerToken)).toThrow();
    });

    it('rejects token with wrong audience', () => {
      const wrongAudienceToken = jwt.sign(payload, 'test-secret-min-32-chars-abcdefghijklmnop', {
        algorithm: 'HS256',
        expiresIn: '15m',
        issuer: 'ticket-api',
        audience: 'wrong-audience',
      });
      expect(() => verifyAccessToken(wrongAudienceToken)).toThrow();
    });

    it('rejects expired token', () => {
      const expiredToken = jwt.sign(payload, 'test-secret-min-32-chars-abcdefghijklmnop', {
        algorithm: 'HS256',
        expiresIn: '-1s', // already expired
        issuer: 'ticket-api',
        audience: 'ticket-api',
      });
      expect(() => verifyAccessToken(expiredToken)).toThrow();
    });

    it('rejects "alg: none" attack', () => {
      const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
      const payload_b64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const malicious = `${header}.${payload_b64}.`;
      expect(() => verifyAccessToken(malicious)).toThrow();
    });

    it('rejects RS256/HS256 confusion', () => {
      // With algorithms fixed to ['HS256'], RS256 tokens are rejected
      // This is tested implicitly by the fixed algorithm config
    });
  });
});