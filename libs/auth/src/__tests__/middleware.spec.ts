/**
 * Tests for Fastify JWT auth middleware
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { loadOrCreateSecret, clearSecretCache } from '../secret';
import { signAdminToken, signBrokerToken } from '../sign';
import { SignJWT } from 'jose';
import { getSecret } from '../secret';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// Shared mock fn — configured per test in beforeEach
const mockVerifyToken = jest.fn();

jest.mock('../verify', () => {
  const actual = jest.requireActual('../verify');
  return {
    __esModule: true,
    ...actual,
    verifyToken: (...args: unknown[]) => mockVerifyToken(...args),
  };
});

// Import middleware AFTER the mock setup
import { extractBearerToken, createJwtAuthHook } from '../middleware';
import { verifyToken as realVerifyToken } from '../verify';

function mockRequest(overrides: Partial<FastifyRequest> = {}): FastifyRequest {
  return {
    url: '/',
    method: 'GET',
    headers: {},
    query: {},
    ...overrides,
  } as unknown as FastifyRequest;
}

function mockReply() {
  const reply: Record<string, jest.Mock> = {};
  reply.code = jest.fn().mockReturnValue(reply);
  reply.send = jest.fn().mockReturnValue(reply);
  return reply as unknown as FastifyReply & { code: jest.Mock; send: jest.Mock };
}

describe('Middleware', () => {
  let tmpDir: string;

  beforeEach(() => {
    clearSecretCache();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-mw-test-'));
    loadOrCreateSecret(tmpDir, '.jwt-secret');
    // Default: delegate to real implementation
    const actual = jest.requireActual('../verify') as typeof import('../verify');
    mockVerifyToken.mockImplementation(actual.verifyToken);
  });

  afterEach(() => {
    clearSecretCache();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('extractBearerToken', () => {
    it('should extract token from Authorization header', () => {
      const req = mockRequest({
        headers: { authorization: 'Bearer my-token' },
      } as Partial<FastifyRequest>);
      expect(extractBearerToken(req)).toBe('my-token');
    });

    it('should extract token from query param', () => {
      const req = mockRequest({
        query: { token: 'query-token' },
      } as Partial<FastifyRequest>);
      expect(extractBearerToken(req)).toBe('query-token');
    });

    it('should prefer Authorization header over query param', () => {
      const req = mockRequest({
        headers: { authorization: 'Bearer header-token' },
        query: { token: 'query-token' },
      } as Partial<FastifyRequest>);
      expect(extractBearerToken(req)).toBe('header-token');
    });

    it('should return undefined when no token present', () => {
      const req = mockRequest();
      expect(extractBearerToken(req)).toBeUndefined();
    });

    it('should return undefined for non-Bearer auth header', () => {
      const req = mockRequest({
        headers: { authorization: 'Basic abc123' },
      } as Partial<FastifyRequest>);
      expect(extractBearerToken(req)).toBeUndefined();
    });
  });

  describe('createJwtAuthHook', () => {
    it('should skip auth for built-in public routes', async () => {
      const hook = createJwtAuthHook();
      const req = mockRequest({ url: '/api/health' });
      const reply = mockReply();

      await hook(req, reply);
      expect(reply.code).not.toHaveBeenCalled();
    });

    it('should skip auth for custom public routes', async () => {
      const hook = createJwtAuthHook({ publicRoutes: ['/custom/public'] });
      const req = mockRequest({ url: '/custom/public/sub' });
      const reply = mockReply();

      await hook(req, reply);
      expect(reply.code).not.toHaveBeenCalled();
    });

    it('should return 401 when no token provided', async () => {
      const hook = createJwtAuthHook();
      const req = mockRequest({ url: '/api/config' });
      const reply = mockReply();

      await hook(req, reply);
      expect(reply.code).toHaveBeenCalledWith(401);
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'UNAUTHORIZED' }),
      );
    });

    it('should return 401 for invalid token', async () => {
      const hook = createJwtAuthHook();
      const req = mockRequest({
        url: '/api/config',
        headers: { authorization: 'Bearer bad-token' },
      } as Partial<FastifyRequest>);
      const reply = mockReply();

      await hook(req, reply);
      expect(reply.code).toHaveBeenCalledWith(401);
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'TOKEN_INVALID' }),
      );
    });

    it('should return 401 with TOKEN_EXPIRED for expired token', async () => {
      const secret = getSecret();
      const now = Math.floor(Date.now() / 1000);
      const expiredToken = await new SignJWT({ role: 'admin' })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject('shield-ui')
        .setIssuedAt(now - 3600)
        .setExpirationTime(now - 1800)
        .sign(secret);

      const hook = createJwtAuthHook();
      const req = mockRequest({
        url: '/api/config',
        headers: { authorization: `Bearer ${expiredToken}` },
      } as Partial<FastifyRequest>);
      const reply = mockReply();

      await hook(req, reply);
      expect(reply.code).toHaveBeenCalledWith(401);
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'TOKEN_EXPIRED' }),
      );
    });

    it('should attach payload for valid admin token', async () => {
      const token = await signAdminToken();
      const hook = createJwtAuthHook();
      const req = mockRequest({
        url: '/api/config',
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
      } as Partial<FastifyRequest>);
      const reply = mockReply();

      await hook(req, reply);
      expect(reply.code).not.toHaveBeenCalled();
      expect(req.jwtPayload).toBeDefined();
      expect(req.jwtPayload!.role).toBe('admin');
    });

    it('should return 403 for broker on admin-only route', async () => {
      const token = await signBrokerToken('p1', 't1');
      const hook = createJwtAuthHook();
      const req = mockRequest({
        url: '/api/config',
        method: 'PUT',
        headers: { authorization: `Bearer ${token}` },
      } as Partial<FastifyRequest>);
      const reply = mockReply();

      await hook(req, reply);
      expect(reply.code).toHaveBeenCalledWith(403);
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'INSUFFICIENT_PERMISSIONS' }),
      );
    });

    it('should allow admin on admin-only route', async () => {
      const token = await signAdminToken();
      const hook = createJwtAuthHook();
      const req = mockRequest({
        url: '/api/config',
        method: 'PUT',
        headers: { authorization: `Bearer ${token}` },
      } as Partial<FastifyRequest>);
      const reply = mockReply();

      await hook(req, reply);
      expect(reply.code).not.toHaveBeenCalled();
    });

    it('should respect custom adminOnlyRoutes', async () => {
      const token = await signBrokerToken('p1', 't1');
      const hook = createJwtAuthHook({
        adminOnlyRoutes: [{ method: 'POST', path: '/api/custom' }],
      });
      const req = mockRequest({
        url: '/api/custom/action',
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      } as Partial<FastifyRequest>);
      const reply = mockReply();

      await hook(req, reply);
      expect(reply.code).toHaveBeenCalledWith(403);
    });

    it('should strip query string from URL for route matching', async () => {
      const hook = createJwtAuthHook();
      const req = mockRequest({ url: '/api/health?foo=bar' });
      const reply = mockReply();

      await hook(req, reply);
      expect(reply.code).not.toHaveBeenCalled();
    });

    it('should use fallback error message when result.error is undefined', async () => {
      mockVerifyToken.mockResolvedValueOnce({ valid: false });

      const hook = createJwtAuthHook();
      const req = mockRequest({
        url: '/api/config',
        headers: { authorization: 'Bearer some-token' },
      } as Partial<FastifyRequest>);
      const reply = mockReply();

      await hook(req, reply);
      expect(reply.code).toHaveBeenCalledWith(401);
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Invalid token', code: 'TOKEN_INVALID' }),
      );
    });
  });
});
