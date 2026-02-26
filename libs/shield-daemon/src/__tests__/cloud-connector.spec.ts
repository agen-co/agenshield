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

// Mock policies
jest.mock('@agenshield/policies', () => ({
  matchProcessPattern: jest.fn((pattern: string, command: string) => {
    // Simple glob matching for tests
    const regex = new RegExp(pattern.replace(/\*/g, '.*'), 'i');
    return regex.test(command);
  }),
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
});
