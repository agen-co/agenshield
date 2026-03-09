/**
 * Tests for auth error classes
 */

import {
  AuthError,
  TokenExpiredError,
  TokenInvalidError,
  InsufficientPermissionsError,
  SudoVerificationError,
  RateLimitError,
  CloudAuthError,
} from '../errors';

describe('Auth errors', () => {
  describe('AuthError', () => {
    it('should set name, code, and message', () => {
      const err = new AuthError('test message', 'TEST_CODE');
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe('AuthError');
      expect(err.code).toBe('TEST_CODE');
      expect(err.message).toBe('test message');
    });

    it('should use default code AUTH_ERROR', () => {
      const err = new AuthError('msg');
      expect(err.code).toBe('AUTH_ERROR');
    });
  });

  describe('TokenExpiredError', () => {
    it('should set defaults', () => {
      const err = new TokenExpiredError();
      expect(err).toBeInstanceOf(AuthError);
      expect(err.name).toBe('TokenExpiredError');
      expect(err.code).toBe('TOKEN_EXPIRED');
      expect(err.message).toBe('Token has expired');
    });

    it('should accept custom message', () => {
      const err = new TokenExpiredError('custom');
      expect(err.message).toBe('custom');
    });
  });

  describe('TokenInvalidError', () => {
    it('should set defaults', () => {
      const err = new TokenInvalidError();
      expect(err).toBeInstanceOf(AuthError);
      expect(err.name).toBe('TokenInvalidError');
      expect(err.code).toBe('TOKEN_INVALID');
      expect(err.message).toBe('Token is invalid');
    });

    it('should accept custom message', () => {
      const err = new TokenInvalidError('bad sig');
      expect(err.message).toBe('bad sig');
    });
  });

  describe('InsufficientPermissionsError', () => {
    it('should set role properties and message', () => {
      const err = new InsufficientPermissionsError('admin', 'broker');
      expect(err).toBeInstanceOf(AuthError);
      expect(err.name).toBe('InsufficientPermissionsError');
      expect(err.code).toBe('INSUFFICIENT_PERMISSIONS');
      expect(err.requiredRole).toBe('admin');
      expect(err.actualRole).toBe('broker');
      expect(err.message).toContain('admin');
      expect(err.message).toContain('broker');
    });
  });

  describe('SudoVerificationError', () => {
    it('should set username and defaults', () => {
      const err = new SudoVerificationError('testuser');
      expect(err).toBeInstanceOf(AuthError);
      expect(err.name).toBe('SudoVerificationError');
      expect(err.code).toBe('SUDO_VERIFICATION_FAILED');
      expect(err.username).toBe('testuser');
      expect(err.message).toBe('Sudo verification failed');
    });

    it('should accept custom message', () => {
      const err = new SudoVerificationError('user1', 'custom msg');
      expect(err.message).toBe('custom msg');
      expect(err.username).toBe('user1');
    });
  });

  describe('RateLimitError', () => {
    it('should set retryAfterMs and message', () => {
      const err = new RateLimitError(5000);
      expect(err).toBeInstanceOf(AuthError);
      expect(err.name).toBe('RateLimitError');
      expect(err.code).toBe('RATE_LIMITED');
      expect(err.retryAfterMs).toBe(5000);
      expect(err.message).toContain('5 seconds');
    });
  });

  describe('CloudAuthError', () => {
    it('should set defaults', () => {
      const err = new CloudAuthError();
      expect(err).toBeInstanceOf(AuthError);
      expect(err.name).toBe('CloudAuthError');
      expect(err.code).toBe('CLOUD_AUTH_FAILED');
      expect(err.message).toBe('Cloud authentication failed');
      expect(err.agentId).toBeUndefined();
    });

    it('should accept custom message and agentId', () => {
      const err = new CloudAuthError('bad sig', 'agent-123');
      expect(err.message).toBe('bad sig');
      expect(err.agentId).toBe('agent-123');
    });
  });
});
