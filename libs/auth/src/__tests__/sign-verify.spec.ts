/**
 * Tests for JWT signing and verification
 */

import { loadOrCreateSecret, clearSecretCache, getSecret } from '../secret';
import { signAdminToken, signBrokerToken, getAdminTtlSeconds } from '../sign';
import { verifyToken, verifyTokenOrThrow } from '../verify';
import { TokenExpiredError, TokenInvalidError } from '../errors';
import { SignJWT } from 'jose';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('JWT sign/verify', () => {
  let tmpDir: string;

  beforeEach(() => {
    clearSecretCache();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-test-'));
    loadOrCreateSecret(tmpDir, '.jwt-secret');
  });

  afterEach(() => {
    clearSecretCache();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('signAdminToken', () => {
    it('should sign a valid admin JWT', async () => {
      const token = await signAdminToken();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // JWT has 3 parts
    });

    it('should produce a verifiable admin token', async () => {
      const token = await signAdminToken();
      const result = await verifyToken(token);

      expect(result.valid).toBe(true);
      expect(result.payload).toBeDefined();
      expect(result.payload!.role).toBe('admin');
      expect(result.payload!.sub).toBe('shield-ui');
      expect((result.payload as { exp: number }).exp).toBeDefined();
    });
  });

  describe('signBrokerToken', () => {
    it('should sign a valid broker JWT', async () => {
      const token = await signBrokerToken('profile-123', 'target-456');
      expect(typeof token).toBe('string');
    });

    it('should produce a verifiable broker token', async () => {
      const token = await signBrokerToken('profile-123', 'target-456');
      const result = await verifyToken(token);

      expect(result.valid).toBe(true);
      expect(result.payload).toBeDefined();
      expect(result.payload!.role).toBe('broker');
      expect(result.payload!.sub).toBe('profile-123');
      expect((result.payload as { targetId: string }).targetId).toBe('target-456');
    });

    it('should not include an expiration', async () => {
      const token = await signBrokerToken('p1', 't1');
      const result = await verifyToken(token);
      expect(result.valid).toBe(true);
      expect((result.payload as Record<string, unknown>).exp).toBeUndefined();
    });
  });

  describe('verifyToken', () => {
    it('should reject a tampered token', async () => {
      const token = await signAdminToken();
      const tampered = token.slice(0, -5) + 'XXXXX';
      const result = await verifyToken(tampered);
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should reject a completely invalid string', async () => {
      const result = await verifyToken('not-a-jwt');
      expect(result.valid).toBe(false);
    });

    it('should reject a token with no role claim', async () => {
      const secret = getSecret();
      const token = await new SignJWT({ foo: 'bar' })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject('shield-ui')
        .setIssuedAt()
        .setExpirationTime('30m')
        .sign(secret);

      const result = await verifyToken(token);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Missing or invalid role claim');
    });

    it('should reject a token with an invalid role claim', async () => {
      const secret = getSecret();
      const token = await new SignJWT({ role: 'superuser' })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject('shield-ui')
        .setIssuedAt()
        .setExpirationTime('30m')
        .sign(secret);

      const result = await verifyToken(token);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Missing or invalid role claim');
    });

    it('should return expired error for expired token', async () => {
      const secret = getSecret();
      const now = Math.floor(Date.now() / 1000);
      const token = await new SignJWT({ role: 'admin' })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject('shield-ui')
        .setIssuedAt(now - 3600)
        .setExpirationTime(now - 1800)
        .sign(secret);

      const result = await verifyToken(token);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Token has expired');
    });

    it('should return claim validation error for nbf in future', async () => {
      const secret = getSecret();
      const now = Math.floor(Date.now() / 1000);
      const token = await new SignJWT({ role: 'admin' })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject('shield-ui')
        .setIssuedAt()
        .setExpirationTime('30m')
        .setNotBefore(now + 3600)
        .sign(secret);

      const result = await verifyToken(token);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Token claim validation failed');
    });

    it('should reject a token signed with a different secret', async () => {
      const token = await signAdminToken();

      // Load a different secret
      clearSecretCache();
      const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-test2-'));
      loadOrCreateSecret(tmpDir2, '.jwt-secret');

      const result = await verifyToken(token);
      expect(result.valid).toBe(false);

      clearSecretCache();
      fs.rmSync(tmpDir2, { recursive: true, force: true });

      // Restore original secret
      loadOrCreateSecret(tmpDir, '.jwt-secret');
    });
  });

  describe('verifyTokenOrThrow', () => {
    it('should return payload for valid token', async () => {
      const token = await signAdminToken();
      const payload = await verifyTokenOrThrow(token);
      expect(payload.role).toBe('admin');
    });

    it('should throw TokenInvalidError for invalid token', async () => {
      await expect(verifyTokenOrThrow('bad-token')).rejects.toThrow(TokenInvalidError);
    });

    it('should throw TokenExpiredError for expired token', async () => {
      const secret = getSecret();
      const now = Math.floor(Date.now() / 1000);
      const token = await new SignJWT({ role: 'admin' })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject('shield-ui')
        .setIssuedAt(now - 3600)
        .setExpirationTime(now - 1800)
        .sign(secret);

      await expect(verifyTokenOrThrow(token)).rejects.toThrow(TokenExpiredError);
    });
  });

  describe('getAdminTtlSeconds', () => {
    it('should return 30 minutes in seconds', () => {
      expect(getAdminTtlSeconds()).toBe(30 * 60);
    });
  });
});
