/**
 * Tests for JWT secret management
 */

import {
  loadOrCreateSecret,
  clearSecretCache,
  getSecret,
  getSecretPath,
  generateSecret,
} from '../secret';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('JwtSecretManager', () => {
  let tmpDir: string;

  beforeEach(() => {
    clearSecretCache();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-secret-test-'));
  });

  afterEach(() => {
    clearSecretCache();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('generateSecret', () => {
    it('should generate a 32-byte secret', () => {
      const secret = generateSecret();
      expect(secret).toBeInstanceOf(Uint8Array);
      expect(secret.length).toBe(32);
    });

    it('should generate unique secrets', () => {
      const s1 = generateSecret();
      const s2 = generateSecret();
      expect(Buffer.from(s1).equals(Buffer.from(s2))).toBe(false);
    });
  });

  describe('loadOrCreateSecret', () => {
    it('should create a new secret file when none exists', () => {
      const secret = loadOrCreateSecret(tmpDir, '.jwt-secret');
      expect(secret).toBeInstanceOf(Uint8Array);
      expect(secret.length).toBe(32);

      const filePath = path.join(tmpDir, '.jwt-secret');
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('should load existing secret from file', () => {
      const first = loadOrCreateSecret(tmpDir, '.jwt-secret');
      // Copy before clearing (clearSecretCache zeros the buffer)
      const firstCopy = Buffer.from(first);
      clearSecretCache();
      const second = loadOrCreateSecret(tmpDir, '.jwt-secret');

      expect(firstCopy.equals(Buffer.from(second))).toBe(true);
    });

    it('should cache the secret in memory', () => {
      const first = loadOrCreateSecret(tmpDir, '.jwt-secret');
      const second = loadOrCreateSecret(tmpDir, '.jwt-secret');
      // Same reference since cached
      expect(first).toBe(second);
    });

    it('should set restrictive file permissions', () => {
      loadOrCreateSecret(tmpDir, '.jwt-secret');
      const filePath = path.join(tmpDir, '.jwt-secret');
      const stat = fs.statSync(filePath);
      expect(stat.mode & 0o777).toBe(0o600);
    });
  });

  describe('getSecret', () => {
    it('should throw if secret not loaded', () => {
      expect(() => getSecret()).toThrow('JWT secret not initialized');
    });

    it('should return secret after loading', () => {
      loadOrCreateSecret(tmpDir, '.jwt-secret');
      expect(() => getSecret()).not.toThrow();
    });
  });

  describe('getSecretPath', () => {
    it('should return the correct path', () => {
      expect(getSecretPath('/test/dir', '.secret')).toBe('/test/dir/.secret');
    });
  });

  describe('clearSecretCache', () => {
    it('should clear the cached secret', () => {
      loadOrCreateSecret(tmpDir, '.jwt-secret');
      clearSecretCache();
      expect(() => getSecret()).toThrow();
    });
  });
});
