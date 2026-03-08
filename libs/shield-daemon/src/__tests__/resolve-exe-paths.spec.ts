/**
 * resolveExePathsByPid — unit tests
 *
 * Tests the OS-level PID-to-executable-path resolution used by the process enforcer.
 */

import { resolveExePathsByPid } from '../services/process-enforcer';

// Mock the system command executor
const mockExec = jest.fn();
jest.mock('../workers/system-command', () => ({
  getSystemExecutor: () => ({ exec: mockExec }),
}));

jest.mock('../logger', () => ({
  getLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

jest.mock('../events/emitter', () => ({
  emitProcessViolation: jest.fn(),
  emitProcessKilled: jest.fn(),
}));

jest.mock('../services/policy-manager', () => ({
  getPolicyManager: jest.fn(),
}));

jest.mock('../services/shield-registry', () => ({
  getActiveShieldOperations: () => [],
}));

jest.mock('@agenshield/storage', () => ({
  getStorage: jest.fn(),
}));

jest.mock('@agenshield/policies', () => ({
  isShieldedProcess: jest.fn(),
}));

const originalPlatform = process.platform;

afterEach(() => {
  mockExec.mockReset();
  Object.defineProperty(process, 'platform', { value: originalPlatform });
});

describe('resolveExePathsByPid', () => {
  it('should return correct map from python3 proc_pidpath output', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });

    mockExec.mockResolvedValue(JSON.stringify({
      '1234': '/usr/local/bin/node',
      '5678': '/Users/foo/.local/bin/claude',
    }));

    const result = await resolveExePathsByPid([1234, 5678]);

    expect(result.size).toBe(2);
    expect(result.get(1234)).toBe('/usr/local/bin/node');
    expect(result.get(5678)).toBe('/Users/foo/.local/bin/claude');
    expect(mockExec).toHaveBeenCalledTimes(1);
  });

  it('should return empty map on non-darwin platform', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });

    const result = await resolveExePathsByPid([1234, 5678]);

    expect(result.size).toBe(0);
    expect(mockExec).not.toHaveBeenCalled();
  });

  it('should return empty map for empty PID list', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });

    const result = await resolveExePathsByPid([]);

    expect(result.size).toBe(0);
    expect(mockExec).not.toHaveBeenCalled();
  });

  it('should return empty map when executor throws', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });

    mockExec.mockRejectedValue(new Error('python3 not found'));

    const result = await resolveExePathsByPid([1234]);

    expect(result.size).toBe(0);
  });

  it('should return empty map when JSON parse fails', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });

    mockExec.mockResolvedValue('not valid json');

    const result = await resolveExePathsByPid([1234]);

    expect(result.size).toBe(0);
  });

  it('should handle partial results when some PIDs have exited', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });

    // Only PID 1234 resolved; PID 9999 had already exited
    mockExec.mockResolvedValue(JSON.stringify({
      '1234': '/usr/bin/vim',
    }));

    const result = await resolveExePathsByPid([1234, 9999]);

    expect(result.size).toBe(1);
    expect(result.get(1234)).toBe('/usr/bin/vim');
    expect(result.has(9999)).toBe(false);
  });
});
