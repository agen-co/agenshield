/* eslint-disable @typescript-eslint/no-explicit-any */

jest.mock('node:child_process', () => ({
  exec: jest.fn(),
}));

jest.mock('node:util', () => ({
  promisify: jest.fn((fn: Function) => {
    return jest.fn((...args: any[]) => {
      return new Promise((resolve, reject) => {
        fn(...args, (err: any, result: any) => {
          if (err) reject(err);
          else resolve(result);
        });
      });
    });
  }),
}));

import { exec } from 'node:child_process';
import { PythonVerifier, verifyPython } from '../python/verifier';

const mockExec = exec as jest.MockedFunction<typeof exec>;

describe('PythonVerifier', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function setupExec(responses: Record<string, { stdout?: string; stderr?: string; error?: Error }>) {
    mockExec.mockImplementation(((cmd: string, ...args: any[]) => {
      const cb = args[args.length - 1];
      for (const [pattern, response] of Object.entries(responses)) {
        if (cmd.includes(pattern)) {
          if (response.error) {
            cb(response.error, { stdout: '', stderr: '' });
          } else {
            cb(null, { stdout: response.stdout || '', stderr: response.stderr || '' });
          }
          return;
        }
      }
      cb(null, { stdout: '', stderr: '' });
    }) as any);
  }

  describe('verify', () => {
    it('returns full success when all checks pass', async () => {
      setupExec({
        '--version': { stdout: 'Python 3.11.0\n' },
        'sitecustomize': { stdout: 'True\n' },
        'create_connection': { error: new Error('AgenShield: blocked') },
        'urlopen': { stdout: 'ok\n' },
      });

      const verifier = new PythonVerifier({ pythonPath: '/usr/bin/python3' });
      const result = await verifier.verify();

      expect(result.success).toBe(true);
      expect(result.pythonVersion).toBe('Python 3.11.0');
      expect(result.sitecustomizeInstalled).toBe(true);
      expect(result.networkBlocked).toBe(true);
      expect(result.brokerAccessible).toBe(true);
    });

    it('reports failure when python version check fails', async () => {
      setupExec({
        '--version': { error: new Error('python not found') },
        'sitecustomize': { stdout: 'True\n' },
        'create_connection': { error: new Error('AgenShield: blocked') },
        'urlopen': { stdout: 'ok\n' },
      });

      const verifier = new PythonVerifier({ pythonPath: '/usr/bin/python3' });
      const result = await verifier.verify();

      expect(result.pythonVersion).toBe('unknown');
      expect(result.details.some((d: string) => d.includes('Failed to get Python version'))).toBe(true);
    });

    it('reports when sitecustomize is not found', async () => {
      setupExec({
        '--version': { stdout: 'Python 3.11.0\n' },
        'sitecustomize': { stdout: 'False\n' },
        'create_connection': { error: new Error('AgenShield: blocked') },
        'urlopen': { stdout: 'ok\n' },
      });

      const verifier = new PythonVerifier({ pythonPath: '/usr/bin/python3' });
      const result = await verifier.verify();

      expect(result.sitecustomizeInstalled).toBe(false);
      expect(result.success).toBe(false);
    });

    it('reports when sitecustomize import fails', async () => {
      setupExec({
        '--version': { stdout: 'Python 3.11.0\n' },
        'sitecustomize': { error: new Error('ImportError') },
        'create_connection': { error: new Error('AgenShield: blocked') },
        'urlopen': { stdout: 'ok\n' },
      });

      const verifier = new PythonVerifier({ pythonPath: '/usr/bin/python3' });
      const result = await verifier.verify();

      expect(result.sitecustomizeInstalled).toBe(false);
    });

    it('reports network not blocked when connection succeeds', async () => {
      setupExec({
        '--version': { stdout: 'Python 3.11.0\n' },
        'sitecustomize': { stdout: 'True\n' },
        'create_connection': { stdout: '' }, // Success = not blocked
        'urlopen': { stdout: 'ok\n' },
      });

      const verifier = new PythonVerifier({ pythonPath: '/usr/bin/python3' });
      const result = await verifier.verify();

      expect(result.networkBlocked).toBe(false);
    });

    it('reports network blocked on Connection refused error', async () => {
      setupExec({
        '--version': { stdout: 'Python 3.11.0\n' },
        'sitecustomize': { stdout: 'True\n' },
        'create_connection': { error: new Error('Connection refused') },
        'urlopen': { stdout: 'ok\n' },
      });

      const verifier = new PythonVerifier({ pythonPath: '/usr/bin/python3' });
      const result = await verifier.verify();

      expect(result.networkBlocked).toBe(true);
    });

    it('reports unknown network status on unrelated error', async () => {
      setupExec({
        '--version': { stdout: 'Python 3.11.0\n' },
        'sitecustomize': { stdout: 'True\n' },
        'create_connection': { error: new Error('DNS resolution failed') },
        'urlopen': { stdout: 'ok\n' },
      });

      const verifier = new PythonVerifier({ pythonPath: '/usr/bin/python3' });
      const result = await verifier.verify();

      expect(result.networkBlocked).toBe(false);
      expect(result.details.some((d: string) => d.includes('Unknown'))).toBe(true);
    });

    it('reports broker not accessible when health check fails', async () => {
      setupExec({
        '--version': { stdout: 'Python 3.11.0\n' },
        'sitecustomize': { stdout: 'True\n' },
        'create_connection': { error: new Error('AgenShield: blocked') },
        'urlopen': { error: new Error('Connection refused') },
      });

      const verifier = new PythonVerifier({ pythonPath: '/usr/bin/python3' });
      const result = await verifier.verify();

      expect(result.brokerAccessible).toBe(false);
    });

    it('uses default broker host and port', async () => {
      const verifier = new PythonVerifier({ pythonPath: '/usr/bin/python3' });
      expect((verifier as any).brokerHost).toBe('localhost');
      expect((verifier as any).brokerPort).toBe(5200);
    });

    it('uses custom broker host and port', async () => {
      const verifier = new PythonVerifier({
        pythonPath: '/usr/bin/python3',
        brokerHost: '10.0.0.1',
        brokerPort: 9999,
      });
      expect((verifier as any).brokerHost).toBe('10.0.0.1');
      expect((verifier as any).brokerPort).toBe(9999);
    });
  });

  describe('verifyPython', () => {
    it('creates verifier and calls verify()', async () => {
      setupExec({
        '--version': { stdout: 'Python 3.11.0\n' },
        'sitecustomize': { stdout: 'True\n' },
        'create_connection': { error: new Error('AgenShield: blocked') },
        'urlopen': { stdout: 'ok\n' },
      });

      const result = await verifyPython('/usr/bin/python3');
      expect(result.pythonVersion).toBe('Python 3.11.0');
    });
  });
});
