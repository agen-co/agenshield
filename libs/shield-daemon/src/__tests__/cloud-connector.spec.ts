/**
 * CloudConnector.handleKillProcess — unit tests
 *
 * Tests the kill_process command handler that processes cloud commands
 * to kill or alert on matching target processes.
 */

import { CloudConnector } from '../services/cloud-connector';

// ── Mocks ────────────────────────────────────────────────────────

// Mock logger
const mockLog = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};
jest.mock('../logger', () => ({
  getLogger: () => mockLog,
}));

// Mock event emitter
const mockEmitProcessViolation = jest.fn();
const mockEmitProcessKilled = jest.fn();
const mockEmitPoliciesUpdated = jest.fn();
jest.mock('../events/emitter', () => ({
  emitProcessViolation: (...args: unknown[]) => mockEmitProcessViolation(...args),
  emitProcessKilled: (...args: unknown[]) => mockEmitProcessKilled(...args),
  emitPoliciesUpdated: (...args: unknown[]) => mockEmitPoliciesUpdated(...args),
}));

// Mock process-enforcer
const mockScanHostProcesses = jest.fn();
const mockKillProcessTree = jest.fn();
jest.mock('../services/process-enforcer', () => ({
  triggerProcessEnforcement: jest.fn().mockResolvedValue(undefined),
  scanHostProcesses: (...args: unknown[]) => mockScanHostProcesses(...args),
  killProcessTree: (...args: unknown[]) => mockKillProcessTree(...args),
  resolveExePathsByPid: jest.fn().mockResolvedValue(new Map()),
}));

// Mock policy-manager
jest.mock('../services/policy-manager', () => ({
  getPolicyManager: jest.fn(() => ({
    recompile: jest.fn(),
  })),
}));

// Mock storage
jest.mock('@agenshield/storage', () => ({
  getStorage: jest.fn(() => ({
    policies: {
      deleteManagedBySource: jest.fn(),
      createManaged: jest.fn(),
    },
    binarySignatures: {
      lookupBySha256: jest.fn(() => null),
    },
  })),
}));

// Mock auth
jest.mock('@agenshield/auth', () => ({
  createAgentSigHeader: jest.fn(() => 'mock-auth-header'),
  loadCloudCredentials: jest.fn(() => null),
}));

// Mock config
jest.mock('../config/index', () => ({
  clearConfigCache: jest.fn(),
}));

// Mock IPC
jest.mock('@agenshield/ipc', () => ({
  PolicyConfigSchema: { parse: jest.fn((v: unknown) => v) },
}));

// Mock policies — use real matchProcessPattern for accurate matching
jest.mock('@agenshield/policies', () => {
  const actual = jest.requireActual('@agenshield/policies');
  return {
    matchProcessPattern: actual.matchProcessPattern,
  };
});

// Mock process-fingerprint
const mockFingerprintProcess = jest.fn();
jest.mock('../services/process-fingerprint', () => ({
  fingerprintProcess: (...args: unknown[]) => mockFingerprintProcess(...args),
}));

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Access the private handleCommand method for testing.
 * The CloudConnector routes commands through handleCommand → handleKillProcess.
 */
function sendCommand(connector: CloudConnector, method: string, params: Record<string, unknown>): Promise<void> {
  // Access private method via type escape
  return (connector as unknown as { handleCommand: (cmd: { id: string; method: string; params: Record<string, unknown> }) => Promise<void> })
    .handleCommand({ id: 'test-cmd-1', method, params });
}

// ── Tests ────────────────────────────────────────────────────────

describe('CloudConnector kill_process handler', () => {
  let connector: CloudConnector;

  beforeEach(() => {
    jest.clearAllMocks();
    connector = new CloudConnector();
    mockKillProcessTree.mockResolvedValue(undefined);
    // Default: fingerprinting finds nothing
    mockFingerprintProcess.mockReturnValue({
      candidateNames: [],
      resolvedPath: null,
      npmPackageName: null,
      sha256: null,
      resolvedVia: null,
    });
  });

  it('kills matching openclaw processes when action is kill', async () => {
    mockScanHostProcesses.mockResolvedValue([
      { pid: 1001, user: 'testuser', command: 'node node_modules/openclaw/bin/main.js' },
      { pid: 1002, user: 'testuser', command: 'git status' },
    ]);

    await sendCommand(connector, 'kill_process', {
      targetProcess: 'openclaw',
      action: 'kill',
    });

    expect(mockScanHostProcesses).toHaveBeenCalled();
    expect(mockEmitProcessViolation).toHaveBeenCalledTimes(1);
    expect(mockKillProcessTree).toHaveBeenCalledWith(1001);
    expect(mockEmitProcessKilled).toHaveBeenCalledTimes(1);
    expect(mockEmitProcessKilled).toHaveBeenCalledWith(
      expect.objectContaining({ pid: 1001, enforcement: 'kill' }),
    );
  });

  it('only alerts when action is alert', async () => {
    mockScanHostProcesses.mockResolvedValue([
      { pid: 2001, user: 'testuser', command: '/usr/bin/openclaw-agent serve' },
    ]);

    await sendCommand(connector, 'kill_process', {
      targetProcess: 'openclaw',
      action: 'alert',
    });

    expect(mockEmitProcessViolation).toHaveBeenCalledTimes(1);
    expect(mockKillProcessTree).not.toHaveBeenCalled();
    expect(mockEmitProcessKilled).not.toHaveBeenCalled();
  });

  it('matches claude-code processes with *claude* pattern', async () => {
    mockScanHostProcesses.mockResolvedValue([
      { pid: 3001, user: 'testuser', command: '/usr/local/bin/claude --interactive' },
      { pid: 3002, user: 'testuser', command: 'node server.js' },
    ]);

    await sendCommand(connector, 'kill_process', {
      targetProcess: 'claude-code',
      action: 'kill',
    });

    expect(mockKillProcessTree).toHaveBeenCalledWith(3001);
    expect(mockKillProcessTree).toHaveBeenCalledTimes(1);
  });

  it('handles unknown targetProcess gracefully', async () => {
    await sendCommand(connector, 'kill_process', {
      targetProcess: 'unknown-agent',
      action: 'kill',
    });

    expect(mockScanHostProcesses).not.toHaveBeenCalled();
    expect(mockKillProcessTree).not.toHaveBeenCalled();
    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.stringContaining('unknown targetProcess'),
    );
  });

  it('does nothing when no processes match', async () => {
    mockScanHostProcesses.mockResolvedValue([
      { pid: 4001, user: 'testuser', command: 'vim file.txt' },
      { pid: 4002, user: 'testuser', command: 'git push' },
    ]);

    await sendCommand(connector, 'kill_process', {
      targetProcess: 'openclaw',
      action: 'kill',
    });

    expect(mockScanHostProcesses).toHaveBeenCalled();
    expect(mockEmitProcessViolation).not.toHaveBeenCalled();
    expect(mockKillProcessTree).not.toHaveBeenCalled();
  });

  it('handles missing targetProcess param', async () => {
    await sendCommand(connector, 'kill_process', {
      action: 'kill',
    });

    expect(mockScanHostProcesses).not.toHaveBeenCalled();
    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.stringContaining('missing targetProcess'),
    );
  });

  it('defaults to alert when action is not specified', async () => {
    mockScanHostProcesses.mockResolvedValue([
      { pid: 5001, user: 'testuser', command: 'openclaw run task' },
    ]);

    await sendCommand(connector, 'kill_process', {
      targetProcess: 'openclaw',
    });

    expect(mockEmitProcessViolation).toHaveBeenCalledTimes(1);
    expect(mockKillProcessTree).not.toHaveBeenCalled();
    expect(mockEmitProcessKilled).not.toHaveBeenCalled();
  });

  it('does NOT kill agenshield-broker even when path contains claude username', async () => {
    mockScanHostProcesses.mockResolvedValue([
      { pid: 6001, user: 'claude', command: '/Users/claude/.agenshield/libexec/agenshield-broker --port 5200' },
      { pid: 6002, user: 'claude', command: '/Users/claude/.local/bin/claude --serve' },
    ]);

    await sendCommand(connector, 'kill_process', {
      targetProcess: 'claude-code',
      action: 'kill',
    });

    // Should only kill the actual claude binary, not the broker
    expect(mockKillProcessTree).toHaveBeenCalledTimes(1);
    expect(mockKillProcessTree).toHaveBeenCalledWith(6002);
    expect(mockKillProcessTree).not.toHaveBeenCalledWith(6001);
  });

  it('identifies renamed binary via fingerprinting when name match fails', async () => {
    mockScanHostProcesses.mockResolvedValue([
      { pid: 7001, user: 'testuser', command: '/usr/local/bin/my-custom-tool --serve' },
    ]);

    mockFingerprintProcess.mockReturnValue({
      candidateNames: ['claude'],
      resolvedPath: '/usr/local/lib/node_modules/@anthropic-ai/claude-code/bin/claude.js',
      npmPackageName: 'claude',
      sha256: 'abc123def456',
      resolvedVia: 'package-json',
    });

    await sendCommand(connector, 'kill_process', {
      targetProcess: 'claude-code',
      action: 'kill',
    });

    expect(mockFingerprintProcess).toHaveBeenCalled();
    expect(mockKillProcessTree).toHaveBeenCalledWith(7001);
  });

  it('does not call fingerprinting when name match already succeeds', async () => {
    mockScanHostProcesses.mockResolvedValue([
      { pid: 8001, user: 'testuser', command: '/usr/bin/claude --serve' },
    ]);

    await sendCommand(connector, 'kill_process', {
      targetProcess: 'claude-code',
      action: 'kill',
    });

    // Name match succeeded — fingerprinting not needed for this process
    expect(mockKillProcessTree).toHaveBeenCalledWith(8001);
    // fingerprintProcess is never called since name matched
    expect(mockFingerprintProcess).not.toHaveBeenCalled();
  });
});
