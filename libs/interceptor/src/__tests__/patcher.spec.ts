/* eslint-disable @typescript-eslint/no-explicit-any */

jest.mock('node:fs/promises', () => ({
  writeFile: jest.fn().mockResolvedValue(undefined),
  readFile: jest.fn().mockResolvedValue(''),
  unlink: jest.fn().mockResolvedValue(undefined),
  mkdir: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('node:child_process', () => ({
  exec: jest.fn((cmd: string, cb: Function) => cb(null, { stdout: '', stderr: '' })),
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

import * as fs from 'node:fs/promises';
import { exec } from 'node:child_process';
import { PythonPatcher } from '../python/patcher';

const mockFs = fs as jest.Mocked<typeof fs>;
const mockExec = exec as jest.MockedFunction<typeof exec>;

describe('PythonPatcher', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: getSitePackagesDir succeeds
    mockExec.mockImplementation(((cmd: string, cb: any) => {
      if (cmd.includes('site.getsitepackages')) {
        cb(null, { stdout: '/usr/lib/python3/site-packages\n', stderr: '' });
      } else if (cmd.includes('--version')) {
        cb(null, { stdout: 'Python 3.11.0\n', stderr: '' });
      } else {
        cb(null, { stdout: '', stderr: '' });
      }
    }) as any);
  });

  describe('install', () => {
    it('writes sitecustomize.py on success', async () => {
      const patcher = new PythonPatcher({ pythonPath: '/usr/bin/python3' });
      const result = await patcher.install();

      expect(result.success).toBe(true);
      expect(result.paths?.sitecustomize).toContain('sitecustomize.py');
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('sitecustomize.py'),
        expect.stringContaining('AgenShield'),
        expect.any(Object)
      );
    });

    it('writes wrapper script when installDir is set', async () => {
      const patcher = new PythonPatcher({
        pythonPath: '/usr/bin/python3',
        installDir: '/opt/agenshield/bin',
      });
      const result = await patcher.install();

      expect(result.success).toBe(true);
      expect(result.paths?.wrapper).toContain('/opt/agenshield/bin/python');
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        '/opt/agenshield/bin/python',
        expect.any(String),
        expect.objectContaining({ mode: 0o755 })
      );
    });

    it('writes sandbox profile when useSandbox is true and installDir is set', async () => {
      const patcher = new PythonPatcher({
        pythonPath: '/usr/bin/python3',
        installDir: '/opt/agenshield/bin',
        useSandbox: true,
      });
      const result = await patcher.install();

      expect(result.success).toBe(true);
      expect(result.paths?.sandboxProfile).toBeDefined();
      expect(mockFs.mkdir).toHaveBeenCalled();
    });

    it('returns failure on error', async () => {
      mockExec.mockImplementation(((cmd: string, cb: any) => {
        cb(new Error('python not found'), { stdout: '', stderr: '' });
      }) as any);

      const patcher = new PythonPatcher({ pythonPath: '/nonexistent/python' });
      const result = await patcher.install();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Installation failed');
    });
  });

  describe('uninstall', () => {
    it('deletes sitecustomize when AgenShield marker is found', async () => {
      mockFs.readFile.mockResolvedValueOnce('# AgenShield Python Network Isolation' as any);

      const patcher = new PythonPatcher({ pythonPath: '/usr/bin/python3' });
      const result = await patcher.uninstall();

      expect(result.success).toBe(true);
      expect(mockFs.unlink).toHaveBeenCalledWith(expect.stringContaining('sitecustomize.py'));
    });

    it('returns false when sitecustomize is not AgenShield', async () => {
      mockFs.readFile.mockResolvedValueOnce('# Custom sitecustomize' as any);

      const patcher = new PythonPatcher({ pythonPath: '/usr/bin/python3' });
      const result = await patcher.uninstall();

      expect(result.success).toBe(false);
      expect(result.message).toContain('does not appear to be AgenShield');
    });

    it('ignores ENOENT when sitecustomize does not exist', async () => {
      const enoent = new Error('ENOENT') as NodeJS.ErrnoException;
      enoent.code = 'ENOENT';
      mockFs.readFile.mockRejectedValueOnce(enoent);

      const patcher = new PythonPatcher({ pythonPath: '/usr/bin/python3' });
      const result = await patcher.uninstall();

      expect(result.success).toBe(true);
    });

    it('throws non-ENOENT errors', async () => {
      const eperm = new Error('EPERM') as NodeJS.ErrnoException;
      eperm.code = 'EPERM';
      mockFs.readFile.mockRejectedValueOnce(eperm);

      const patcher = new PythonPatcher({ pythonPath: '/usr/bin/python3' });
      const result = await patcher.uninstall();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Uninstallation failed');
    });

    it('deletes wrapper when installDir is set', async () => {
      mockFs.readFile.mockResolvedValueOnce('AgenShield content' as any);

      const patcher = new PythonPatcher({
        pythonPath: '/usr/bin/python3',
        installDir: '/opt/agenshield/bin',
      });
      const result = await patcher.uninstall();

      expect(result.success).toBe(true);
      expect(mockFs.unlink).toHaveBeenCalledWith('/opt/agenshield/bin/python');
    });

    it('ignores wrapper deletion errors', async () => {
      mockFs.readFile.mockResolvedValueOnce('AgenShield content' as any);
      // First unlink succeeds (sitecustomize), second fails (wrapper)
      mockFs.unlink
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('ENOENT'));

      const patcher = new PythonPatcher({
        pythonPath: '/usr/bin/python3',
        installDir: '/opt/bin',
      });
      const result = await patcher.uninstall();

      expect(result.success).toBe(true);
    });
  });

  describe('isInstalled', () => {
    it('returns true when AgenShield marker is found', async () => {
      mockFs.readFile.mockResolvedValueOnce('# AgenShield marker' as any);

      const patcher = new PythonPatcher({ pythonPath: '/usr/bin/python3' });
      expect(await patcher.isInstalled()).toBe(true);
    });

    it('returns false when marker is not found', async () => {
      mockFs.readFile.mockResolvedValueOnce('# custom content' as any);

      const patcher = new PythonPatcher({ pythonPath: '/usr/bin/python3' });
      expect(await patcher.isInstalled()).toBe(false);
    });

    it('returns false on read error', async () => {
      mockFs.readFile.mockRejectedValueOnce(new Error('ENOENT'));

      const patcher = new PythonPatcher({ pythonPath: '/usr/bin/python3' });
      expect(await patcher.isInstalled()).toBe(false);
    });
  });

  describe('getPythonVersion', () => {
    it('returns python version string', async () => {
      const patcher = new PythonPatcher({ pythonPath: '/usr/bin/python3' });
      const version = await patcher.getPythonVersion();
      expect(version).toBe('Python 3.11.0');
    });
  });
});
