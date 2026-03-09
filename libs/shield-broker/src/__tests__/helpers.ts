/**
 * Shared test helpers for shield-broker tests
 */

import type { HandlerContext, BrokerConfig } from '../types.js';
import type { HandlerDependencies } from '../handlers/types.js';

export function createMockConfig(overrides?: Partial<BrokerConfig>): BrokerConfig {
  return {
    socketPath: '/tmp/test-broker.sock',
    httpEnabled: true,
    httpPort: 0,
    httpHost: '127.0.0.1',
    configPath: '/tmp/test-config',
    policiesPath: '/tmp/test-policies',
    auditLogPath: '/tmp/test-audit.log',
    logLevel: 'error',
    failOpen: false,
    socketMode: 0o660,
    daemonUrl: 'http://127.0.0.1:5200',
    ...overrides,
  };
}

export function createHandlerContext(overrides?: Partial<HandlerContext>): HandlerContext {
  return {
    requestId: 'test-req-1',
    channel: 'socket',
    timestamp: new Date(),
    config: createMockConfig(),
    ...overrides,
  };
}

export function createMockDeps(overrides?: Partial<HandlerDependencies>): HandlerDependencies {
  return {
    policyEnforcer: {
      check: jest.fn().mockResolvedValue({ allowed: true }),
      getPolicies: jest.fn().mockReturnValue({ version: '1.0.0', defaultAction: 'deny', rules: [] }),
      addRule: jest.fn(),
      removeRule: jest.fn(),
    } as any,
    auditLogger: {
      log: jest.fn().mockResolvedValue(undefined),
    } as any,
    secretVault: {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(false),
      list: jest.fn().mockReturnValue([]),
      has: jest.fn().mockReturnValue(false),
    } as any,
    secretResolver: {
      getSecretsForExec: jest.fn().mockReturnValue({}),
      getSecretNamesForExec: jest.fn().mockReturnValue([]),
      updateFromPush: jest.fn(),
      clear: jest.fn(),
    } as any,
    commandAllowlist: {
      resolve: jest.fn().mockReturnValue('/usr/bin/test'),
      list: jest.fn().mockReturnValue([]),
      add: jest.fn(),
      remove: jest.fn(),
      isBuiltin: jest.fn().mockReturnValue(false),
    } as any,
    onExecMonitor: jest.fn(),
    onExecDenied: jest.fn(),
    daemonUrl: 'http://127.0.0.1:5200',
    ...overrides,
  };
}
