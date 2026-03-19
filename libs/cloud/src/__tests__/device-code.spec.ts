/**
 * Tests for device code flow
 */

import {
  initiateDeviceCode,
  pollDeviceCode,
  registerDevice,
} from '../device-code';

describe('Device code flow', () => {
  const origEnv = { ...process.env };
  const originalFetch = global.fetch;

  afterEach(() => {
    process.env = { ...origEnv };
    global.fetch = originalFetch;
  });

  describe('initiateDeviceCode', () => {
    it('should POST to device-code endpoint', async () => {
      const mockResponse = {
        deviceCode: 'dc-123',
        userCode: 'ABCD-1234',
        verificationUri: 'https://cloud.test/verify',
        expiresIn: 900,
        interval: 5,
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await initiateDeviceCode('https://cloud.test');
      expect(result).toEqual(mockResponse);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://cloud.test/api/agents/device-code',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('should pass orgClientId when provided', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      await initiateDeviceCode('https://cloud.test', 'org-123');
      const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      expect(body.orgClientId).toBe('org-123');
    });

    it('should use default cloud URL when cloudUrl is undefined', async () => {
      delete process.env['AGENSHIELD_CLOUD_URL'];
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      await initiateDeviceCode(undefined);
      expect((global.fetch as jest.Mock).mock.calls[0][0]).toContain('localhost:9090');
    });

    it('should not include orgClientId when not provided', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      await initiateDeviceCode('https://cloud.test');
      const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      expect(body.orgClientId).toBeUndefined();
    });

    it('should throw on non-ok response', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal error'),
      });

      await expect(initiateDeviceCode('https://cloud.test')).rejects.toThrow(
        'Failed to initiate device code flow: 500',
      );
    });

    it('should handle text() failure on error response', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 502,
        text: () => Promise.reject(new Error('body read fail')),
      });

      await expect(initiateDeviceCode('https://cloud.test')).rejects.toThrow('502');
    });
  });

  describe('pollDeviceCode', () => {
    it('should return approved result immediately', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 'approved', enrollmentToken: 'et-1' }),
      });

      const result = await pollDeviceCode('https://cloud.test', 'dc-123', 0.01, 5000);
      expect(result.status).toBe('approved');
      expect(result.enrollmentToken).toBe('et-1');
    });

    it('should poll until approved', async () => {
      let callCount = 0;
      global.fetch = jest.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve(
              callCount < 3
                ? { status: 'authorization_pending' }
                : { status: 'approved', enrollmentToken: 'et-2' },
            ),
        });
      });

      const result = await pollDeviceCode('https://cloud.test', 'dc-123', 0.01, 5000);
      expect(result.status).toBe('approved');
      expect(callCount).toBe(3);
    });

    it('should throw on non-ok poll response', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('err'),
      });

      await expect(
        pollDeviceCode('https://cloud.test', 'dc-123', 0.01, 5000),
      ).rejects.toThrow('Poll failed: 500');
    });

    it('should handle text() failure on poll error', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 503,
        text: () => Promise.reject(new Error('fail')),
      });

      await expect(
        pollDeviceCode('https://cloud.test', 'dc-123', 0.01, 5000),
      ).rejects.toThrow('503');
    });

    it('should return expired on timeout', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 'authorization_pending' }),
      });

      const result = await pollDeviceCode('https://cloud.test', 'dc-123', 0.01, 1);
      expect(result.status).toBe('expired');
      expect(result.error).toContain('timed out');
    });

    it('should use default cloud URL when cloudUrl is undefined', async () => {
      delete process.env['AGENSHIELD_CLOUD_URL'];
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 'approved' }),
      });

      await pollDeviceCode(undefined, 'dc-123', 0.01, 5000);
      expect((global.fetch as jest.Mock).mock.calls[0][0]).toContain('localhost:9090');
    });

    it('should use default timeoutMs when not provided', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 'approved' }),
      });

      const result = await pollDeviceCode('https://cloud.test', 'dc-123', 0.01);
      expect(result.status).toBe('approved');
    });
  });

  describe('registerDevice', () => {
    it('should register and return agent data', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            agent: { id: 'agent-1' },
            agentKey: { id: 'key-1' },
          }),
      });

      const result = await registerDevice(
        'https://cloud.test',
        'et-1',
        'pub-key',
        'my-host',
        '1.0.0',
      );
      expect(result).toEqual({ agentId: 'agent-1', agentKey: 'key-1', companyName: '' });
    });

    it('should throw on non-ok response', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve('Bad request'),
      });

      await expect(
        registerDevice('https://cloud.test', 'et-1', 'pk', 'host', '1.0'),
      ).rejects.toThrow('Device registration failed: 400');
    });

    it('should handle text() failure on error', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.reject(new Error('fail')),
      });

      await expect(
        registerDevice('https://cloud.test', 'et-1', 'pk', 'host', '1.0'),
      ).rejects.toThrow('500');
    });

    it('should use default cloud URL when undefined', async () => {
      delete process.env['AGENSHIELD_CLOUD_URL'];
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            agent: { id: 'a1' },
            agentKey: { id: 'k1' },
          }),
      });

      await registerDevice(undefined, 'et-1', 'pk', 'host', '1.0');
      expect((global.fetch as jest.Mock).mock.calls[0][0]).toContain(
        'localhost:9090',
      );
    });
  });
});
