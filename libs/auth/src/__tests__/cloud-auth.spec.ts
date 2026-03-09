/**
 * Tests for cloud authentication primitives
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  CLOUD_CONFIG,
  generateEd25519Keypair,
  createAgentSigHeader,
  parseAgentSigHeader,
  verifyAgentSig,
  saveCloudCredentials,
  loadCloudCredentials,
  isCloudEnrolled,
  initiateDeviceCode,
  pollDeviceCode,
  registerDevice,
} from '../cloud-auth';

describe('Cloud auth', () => {
  let tmpDir: string;
  const origEnv = { ...process.env };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-auth-test-'));
    process.env['AGENSHIELD_USER_HOME'] = tmpDir;
  });

  afterEach(() => {
    process.env = { ...origEnv };
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('CLOUD_CONFIG', () => {
    it('should return default URL when env not set', () => {
      delete process.env['AGENSHIELD_CLOUD_URL'];
      expect(CLOUD_CONFIG.url).toBe('http://localhost:9090');
    });

    it('should use env override for URL', () => {
      process.env['AGENSHIELD_CLOUD_URL'] = 'https://cloud.example.com';
      expect(CLOUD_CONFIG.url).toBe('https://cloud.example.com');
    });

    it('should resolve credentialsPath using AGENSHIELD_USER_HOME', () => {
      expect(CLOUD_CONFIG.credentialsPath).toBe(
        path.join(tmpDir, '.agenshield', 'cloud.json'),
      );
    });

    it('should fall back to HOME for credentialsPath', () => {
      delete process.env['AGENSHIELD_USER_HOME'];
      process.env['HOME'] = '/test/home';
      expect(CLOUD_CONFIG.credentialsPath).toBe(
        path.join('/test/home', '.agenshield', 'cloud.json'),
      );
    });

    it('should fall back to os.homedir() for credentialsPath', () => {
      delete process.env['AGENSHIELD_USER_HOME'];
      delete process.env['HOME'];
      const result = CLOUD_CONFIG.credentialsPath;
      expect(result).toContain('.agenshield');
      expect(result).toContain('cloud.json');
    });
  });

  describe('generateEd25519Keypair', () => {
    it('should return PEM-encoded public and private keys', () => {
      const kp = generateEd25519Keypair();
      expect(kp.publicKey).toContain('BEGIN PUBLIC KEY');
      expect(kp.privateKey).toContain('BEGIN PRIVATE KEY');
    });
  });

  describe('AgentSig', () => {
    let kp: { publicKey: string; privateKey: string };

    beforeEach(() => {
      kp = generateEd25519Keypair();
    });

    describe('createAgentSigHeader', () => {
      it('should produce AgentSig format', () => {
        const header = createAgentSigHeader('agent-1', kp.privateKey);
        expect(header).toMatch(/^AgentSig agent-1:\d+:.+$/);
      });
    });

    describe('parseAgentSigHeader', () => {
      it('should parse a valid header', () => {
        const header = createAgentSigHeader('agent-1', kp.privateKey);
        const parts = parseAgentSigHeader(header);
        expect(parts).not.toBeNull();
        expect(parts!.agentId).toBe('agent-1');
        expect(typeof parts!.timestamp).toBe('number');
        expect(parts!.signature).toBeInstanceOf(Buffer);
      });

      it('should return null for non-AgentSig header', () => {
        expect(parseAgentSigHeader('Bearer token')).toBeNull();
      });

      it('should return null for incomplete parts', () => {
        expect(parseAgentSigHeader('AgentSig agent-1:123')).toBeNull();
      });

      it('should return null for NaN timestamp', () => {
        expect(parseAgentSigHeader('AgentSig agent-1:abc:c2ln')).toBeNull();
      });
    });

    describe('verifyAgentSig', () => {
      it('should verify a valid signature', () => {
        const header = createAgentSigHeader('agent-1', kp.privateKey);
        const result = verifyAgentSig(header, kp.publicKey);
        expect(result).toBe('agent-1');
      });

      it('should reject malformed header', () => {
        expect(verifyAgentSig('garbage', kp.publicKey)).toBeNull();
      });

      it('should reject stale timestamp', () => {
        // Manually craft a header with old timestamp
        const { sign } = require('node:crypto');
        const oldTs = (Date.now() - 10 * 60 * 1000).toString();
        const data = Buffer.from(`agent-1:${oldTs}`);
        const sig = sign(null, data, kp.privateKey);
        const header = `AgentSig agent-1:${oldTs}:${sig.toString('base64')}`;

        expect(verifyAgentSig(header, kp.publicKey)).toBeNull();
      });

      it('should reject wrong public key', () => {
        const header = createAgentSigHeader('agent-1', kp.privateKey);
        const otherKp = generateEd25519Keypair();
        expect(verifyAgentSig(header, otherKp.publicKey)).toBeNull();
      });
    });
  });

  describe('Cloud credentials', () => {
    it('should save and load credentials', () => {
      saveCloudCredentials('agent-1', 'pk-data', 'https://cloud.test', 'TestCo');
      const creds = loadCloudCredentials();
      expect(creds).not.toBeNull();
      expect(creds!.agentId).toBe('agent-1');
      expect(creds!.privateKey).toBe('pk-data');
      expect(creds!.cloudUrl).toBe('https://cloud.test');
      expect(creds!.companyName).toBe('TestCo');
      expect(creds!.registeredAt).toBeDefined();
    });

    it('should return null when no credentials file', () => {
      expect(loadCloudCredentials()).toBeNull();
    });

    it('should return null for invalid JSON', () => {
      const credPath = CLOUD_CONFIG.credentialsPath;
      fs.mkdirSync(path.dirname(credPath), { recursive: true });
      fs.writeFileSync(credPath, 'not json');
      expect(loadCloudCredentials()).toBeNull();
    });

    it('should return null when missing required fields', () => {
      const credPath = CLOUD_CONFIG.credentialsPath;
      fs.mkdirSync(path.dirname(credPath), { recursive: true });
      fs.writeFileSync(credPath, JSON.stringify({ agentId: '', privateKey: '' }));
      expect(loadCloudCredentials()).toBeNull();
    });

    describe('isCloudEnrolled', () => {
      it('should return false when not enrolled', () => {
        expect(isCloudEnrolled()).toBe(false);
      });

      it('should return true when enrolled', () => {
        saveCloudCredentials('a1', 'pk', 'url', 'co');
        expect(isCloudEnrolled()).toBe(true);
      });
    });
  });

  describe('Device code flow', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
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
        // Call with only 3 args to exercise the default timeoutMs parameter
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
        expect(result).toEqual({ agentId: 'agent-1', agentKey: 'key-1' });
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
});
