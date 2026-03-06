/* eslint-disable no-var */

// Use `var` for mock holders to avoid TDZ errors with SWC/Jest hoisting.
var mockExecAsync: jest.Mock;

jest.mock('node:fs/promises', () => ({
  writeFile: jest.fn().mockResolvedValue(undefined),
  mkdir: jest.fn().mockResolvedValue(undefined),
  readdir: jest.fn().mockResolvedValue([]),
  stat: jest.fn(),
  symlink: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('node:util', () => ({
  ...jest.requireActual('node:util'),
  promisify: jest.fn(() => {
    mockExecAsync = jest.fn().mockResolvedValue({ stdout: '', stderr: '' });
    return mockExecAsync;
  }),
}));

jest.mock('node:child_process', () => ({
  exec: jest.fn(),
}));

import * as fs from 'node:fs/promises';
import {
  generateGenericWrapper,
  installGenericWrapper,
  syncGenericWrappers,
} from '../../wrappers/generic-wrapper';

const mockFs = fs as jest.Mocked<typeof fs>;

describe('generateGenericWrapper', () => {
  it('returns a non-empty string', () => {
    const result = generateGenericWrapper();
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('starts with a bash shebang', () => {
    const result = generateGenericWrapper();
    expect(result.startsWith('#!/bin/bash')).toBe(true);
  });

  it('contains basename $0 to detect command name', () => {
    const result = generateGenericWrapper();
    expect(result).toContain('basename "$0"');
  });

  it('contains shield-client check-exec call', () => {
    const result = generateGenericWrapper();
    expect(result).toContain('shield-client');
    expect(result).toContain('check-exec');
  });

  it('contains policy denied message with exit code 126', () => {
    const result = generateGenericWrapper();
    expect(result).toContain('denied by policy');
    expect(result).toContain('exit 126');
  });

  it('contains broker unreachable message', () => {
    const result = generateGenericWrapper();
    expect(result).toContain('broker unreachable');
  });

  it('searches system directories for real binary', () => {
    const result = generateGenericWrapper();
    expect(result).toContain('/usr/local/bin');
    expect(result).toContain('/usr/bin');
    expect(result).toContain('/usr/sbin');
    expect(result).toContain('/bin');
    expect(result).toContain('/sbin');
  });

  it('contains real binary not found message with exit code 127', () => {
    const result = generateGenericWrapper();
    expect(result).toContain('real binary not found');
    expect(result).toContain('exit 127');
  });

  it('passes all arguments to real binary via "$@"', () => {
    const result = generateGenericWrapper();
    expect(result).toContain('"$@"');
  });
});

describe('installGenericWrapper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Re-establish defaults after clearAllMocks
    mockFs.mkdir.mockResolvedValue(undefined);
    mockFs.writeFile.mockResolvedValue(undefined);
    mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
  });

  it('creates the target directory', async () => {
    await installGenericWrapper('/Users/testuser');

    expect(mockFs.mkdir).toHaveBeenCalledWith(
      '/Users/testuser/.agenshield/bin',
      { recursive: true },
    );
  });

  it('writes wrapper file without sudo', async () => {
    const result = await installGenericWrapper('/Users/testuser');

    expect(mockFs.writeFile).toHaveBeenCalledWith(
      '/Users/testuser/.agenshield/bin/generic-wrapper',
      expect.stringContaining('#!/bin/bash'),
      { mode: 0o755 },
    );
    expect(result).toBe('/Users/testuser/.agenshield/bin/generic-wrapper');
  });

  it('returns the installed path', async () => {
    const result = await installGenericWrapper('/home/agent');

    expect(result).toBe('/home/agent/.agenshield/bin/generic-wrapper');
  });

  it('uses sudo tee and chmod when useSudo is true', async () => {
    await installGenericWrapper('/Users/testuser', { useSudo: true });

    expect(mockExecAsync).toHaveBeenCalledWith(
      expect.stringContaining('sudo tee'),
    );
    expect(mockExecAsync).toHaveBeenCalledWith(
      expect.stringContaining('sudo chmod 755'),
    );
    // writeFile should NOT be called in sudo mode
    expect(mockFs.writeFile).not.toHaveBeenCalled();
  });

  it('falls back to sudo mkdir when mkdir fails and useSudo is true', async () => {
    mockFs.mkdir.mockRejectedValueOnce(new Error('EACCES'));

    await installGenericWrapper('/Users/testuser', { useSudo: true });

    expect(mockExecAsync).toHaveBeenCalledWith(
      expect.stringContaining('sudo mkdir -p'),
    );
  });

  it('does not use sudo mkdir when mkdir fails and useSudo is false', async () => {
    mockFs.mkdir.mockRejectedValueOnce(new Error('EACCES'));

    // Should not throw even if mkdir fails, because the catch block
    // only runs sudo mkdir if useSudo is true
    await installGenericWrapper('/Users/testuser');

    // writeFile is still called (directory might already exist)
    expect(mockFs.writeFile).toHaveBeenCalled();
    // No sudo calls
    expect(mockExecAsync).not.toHaveBeenCalled();
  });
});

describe('syncGenericWrappers', () => {
  const agentBinDir = '/Users/agent/.agenshield/bin';
  const genericWrapperPath = '/Users/agent/.agenshield/bin/generic-wrapper';

  beforeEach(() => {
    jest.clearAllMocks();
    // Re-establish defaults
    mockFs.readdir.mockResolvedValue([]);
    mockFs.stat.mockResolvedValue({
      isFile: () => true,
      mode: 0o755,
    } as any);
    mockFs.symlink.mockResolvedValue(undefined);
    mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
  });

  it('returns empty lists when agent dir and system dirs are empty', async () => {
    const result = await syncGenericWrappers(agentBinDir, genericWrapperPath);

    expect(result.created).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it('skips entries that already exist in agent bin dir', async () => {
    // First call: readdir for agentBinDir returns existing files
    // Second+ calls: readdir for system dirs
    mockFs.readdir
      .mockResolvedValueOnce(['git', 'npm'] as any) // agentBinDir
      .mockResolvedValueOnce(['git', 'ls'] as any)  // /usr/bin
      .mockResolvedValueOnce([] as any);             // /usr/local/bin

    const result = await syncGenericWrappers(agentBinDir, genericWrapperPath);

    expect(result.skipped).toContain('git');
    expect(result.created).toContain('ls');
  });

  it('skips hidden files (starting with dot)', async () => {
    mockFs.readdir
      .mockResolvedValueOnce([] as any)                // agentBinDir
      .mockResolvedValueOnce(['.hidden', 'ls'] as any) // /usr/bin
      .mockResolvedValueOnce([] as any);               // /usr/local/bin

    const result = await syncGenericWrappers(agentBinDir, genericWrapperPath);

    expect(result.skipped).toContain('.hidden');
    expect(result.created).toContain('ls');
  });

  it('skips non-file entries (directories)', async () => {
    mockFs.readdir
      .mockResolvedValueOnce([] as any)         // agentBinDir
      .mockResolvedValueOnce(['mydir'] as any)  // /usr/bin
      .mockResolvedValueOnce([] as any);        // /usr/local/bin

    mockFs.stat.mockResolvedValue({
      isFile: () => false,
      mode: 0o755,
    } as any);

    const result = await syncGenericWrappers(agentBinDir, genericWrapperPath);

    expect(result.created).not.toContain('mydir');
    expect(result.skipped).not.toContain('mydir');
  });

  it('skips non-executable files', async () => {
    mockFs.readdir
      .mockResolvedValueOnce([] as any)             // agentBinDir
      .mockResolvedValueOnce(['noexec'] as any)     // /usr/bin
      .mockResolvedValueOnce([] as any);            // /usr/local/bin

    mockFs.stat.mockResolvedValue({
      isFile: () => true,
      mode: 0o644, // no execute bits
    } as any);

    const result = await syncGenericWrappers(agentBinDir, genericWrapperPath);

    expect(result.created).not.toContain('noexec');
  });

  it('creates symlinks without sudo by default', async () => {
    mockFs.readdir
      .mockResolvedValueOnce([] as any)        // agentBinDir
      .mockResolvedValueOnce(['ls'] as any)    // /usr/bin
      .mockResolvedValueOnce([] as any);       // /usr/local/bin

    const result = await syncGenericWrappers(agentBinDir, genericWrapperPath);

    expect(mockFs.symlink).toHaveBeenCalledWith(
      genericWrapperPath,
      `${agentBinDir}/ls`,
    );
    expect(result.created).toContain('ls');
  });

  it('creates symlinks with sudo when useSudo is true', async () => {
    mockFs.readdir
      .mockResolvedValueOnce([] as any)        // agentBinDir
      .mockResolvedValueOnce(['ls'] as any)    // /usr/bin
      .mockResolvedValueOnce([] as any);       // /usr/local/bin

    const result = await syncGenericWrappers(agentBinDir, genericWrapperPath, {
      useSudo: true,
    });

    expect(mockExecAsync).toHaveBeenCalledWith(
      expect.stringContaining('sudo ln -sf'),
    );
    expect(mockFs.symlink).not.toHaveBeenCalled();
    expect(result.created).toContain('ls');
  });

  it('handles readdir failure for agentBinDir gracefully', async () => {
    mockFs.readdir
      .mockRejectedValueOnce(new Error('ENOENT'))   // agentBinDir fails
      .mockResolvedValueOnce(['ls'] as any)          // /usr/bin
      .mockResolvedValueOnce([] as any);             // /usr/local/bin

    const result = await syncGenericWrappers(agentBinDir, genericWrapperPath);

    // Should still create symlinks since existingFiles defaults to empty set
    expect(result.created).toContain('ls');
  });

  it('handles readdir failure for system dirs gracefully', async () => {
    mockFs.readdir
      .mockResolvedValueOnce([] as any)              // agentBinDir
      .mockRejectedValueOnce(new Error('ENOENT'))    // /usr/bin fails
      .mockRejectedValueOnce(new Error('ENOENT'));   // /usr/local/bin fails

    const result = await syncGenericWrappers(agentBinDir, genericWrapperPath);

    expect(result.created).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it('handles symlink failure gracefully and adds to skipped', async () => {
    mockFs.readdir
      .mockResolvedValueOnce([] as any)        // agentBinDir
      .mockResolvedValueOnce(['ls'] as any)    // /usr/bin
      .mockResolvedValueOnce([] as any);       // /usr/local/bin

    mockFs.symlink.mockRejectedValueOnce(new Error('EEXIST'));

    const result = await syncGenericWrappers(agentBinDir, genericWrapperPath);

    expect(result.created).not.toContain('ls');
    expect(result.skipped).toContain('ls');
  });

  it('handles stat failure gracefully and skips the entry', async () => {
    mockFs.readdir
      .mockResolvedValueOnce([] as any)        // agentBinDir
      .mockResolvedValueOnce(['bad'] as any)   // /usr/bin
      .mockResolvedValueOnce([] as any);       // /usr/local/bin

    mockFs.stat.mockRejectedValueOnce(new Error('ENOENT'));

    const result = await syncGenericWrappers(agentBinDir, genericWrapperPath);

    expect(result.created).not.toContain('bad');
    expect(result.skipped).not.toContain('bad');
  });

  it('adds created entries to existingFiles to prevent duplicates across dirs', async () => {
    // "ls" appears in both /usr/bin and /usr/local/bin
    mockFs.readdir
      .mockResolvedValueOnce([] as any)        // agentBinDir
      .mockResolvedValueOnce(['ls'] as any)    // /usr/bin
      .mockResolvedValueOnce(['ls'] as any);   // /usr/local/bin

    const result = await syncGenericWrappers(agentBinDir, genericWrapperPath);

    // Should be created once, then skipped the second time
    expect(result.created.filter((e) => e === 'ls')).toHaveLength(1);
    expect(result.skipped).toContain('ls');
  });

  it('processes multiple executables from multiple system dirs', async () => {
    mockFs.readdir
      .mockResolvedValueOnce([] as any)                    // agentBinDir
      .mockResolvedValueOnce(['cat', 'grep'] as any)       // /usr/bin
      .mockResolvedValueOnce(['brew', 'wget'] as any);     // /usr/local/bin

    const result = await syncGenericWrappers(agentBinDir, genericWrapperPath);

    expect(result.created).toContain('cat');
    expect(result.created).toContain('grep');
    expect(result.created).toContain('brew');
    expect(result.created).toContain('wget');
    expect(result.created).toHaveLength(4);
  });

  it('handles sudo ln failure gracefully', async () => {
    mockFs.readdir
      .mockResolvedValueOnce([] as any)        // agentBinDir
      .mockResolvedValueOnce(['ls'] as any)    // /usr/bin
      .mockResolvedValueOnce([] as any);       // /usr/local/bin

    mockExecAsync.mockRejectedValueOnce(new Error('sudo: command not found'));

    const result = await syncGenericWrappers(agentBinDir, genericWrapperPath, {
      useSudo: true,
    });

    expect(result.created).not.toContain('ls');
    expect(result.skipped).toContain('ls');
  });
});
