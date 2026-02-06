#!/usr/bin/env node
/**
 * AgenShield Broker Daemon Entry Point
 *
 * Starts the Unix socket server and optional HTTP fallback server.
 */

import { UnixSocketServer } from './server.js';
import { HttpFallbackServer } from './http-fallback.js';
import { PolicyEnforcer } from './policies/enforcer.js';
import { getDefaultPolicies } from './policies/builtin.js';
import { CommandAllowlist } from './policies/command-allowlist.js';
import { AuditLogger } from './audit/logger.js';
import { SecretVault } from './secrets/vault.js';
import type { BrokerConfig } from './types.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Commands that get wrapper shims in the agent's bin directory.
 * Must stay in sync with PROXIED_COMMANDS in shield-sandbox/shield-exec.ts.
 */
const PROXIED_COMMANDS = [
  'curl', 'wget', 'git', 'ssh', 'scp', 'rsync',
  'brew', 'npm', 'npx', 'pip', 'pip3',
  'open-url', 'shieldctl', 'agenco',
] as const;

/**
 * Load configuration from environment and config file
 */
function loadConfig(): BrokerConfig {
  const configPath =
    process.env['AGENSHIELD_CONFIG'] || '/opt/agenshield/config/shield.json';

  let fileConfig: Partial<BrokerConfig> = {};
  if (fs.existsSync(configPath)) {
    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      fileConfig = JSON.parse(content);
    } catch (error) {
      console.warn(`Warning: Failed to load config from ${configPath}:`, error);
    }
  }

  return {
    socketPath:
      process.env['AGENSHIELD_SOCKET'] ||
      fileConfig.socketPath ||
      '/var/run/agenshield/agenshield.sock',
    httpEnabled:
      process.env['AGENSHIELD_HTTP_ENABLED'] !== 'false' &&
      (fileConfig.httpEnabled ?? true),
    httpPort: parseInt(
      process.env['AGENSHIELD_HTTP_PORT'] || String(fileConfig.httpPort || 5201),
      10
    ),
    httpHost:
      process.env['AGENSHIELD_HTTP_HOST'] || fileConfig.httpHost || 'localhost',
    configPath,
    policiesPath:
      process.env['AGENSHIELD_POLICIES'] ||
      fileConfig.policiesPath ||
      '/opt/agenshield/policies',
    auditLogPath:
      process.env['AGENSHIELD_AUDIT_LOG'] ||
      fileConfig.auditLogPath ||
      '/var/log/agenshield/audit.log',
    logLevel:
      (process.env['AGENSHIELD_LOG_LEVEL'] as BrokerConfig['logLevel']) ||
      fileConfig.logLevel ||
      'info',
    failOpen:
      process.env['AGENSHIELD_FAIL_OPEN'] === 'true' ||
      (fileConfig.failOpen ?? false),
    socketMode: fileConfig.socketMode || 0o666,
    socketOwner: fileConfig.socketOwner || 'clawbroker',
    socketGroup: fileConfig.socketGroup || 'clawshield',
    agentHome:
      process.env['AGENSHIELD_AGENT_HOME'] ||
      (fileConfig as Record<string, unknown>).agentHome as string | undefined,
    daemonUrl:
      process.env['AGENSHIELD_DAEMON_URL'] ||
      fileConfig.daemonUrl ||
      'http://127.0.0.1:5200',
  };
}

/**
 * Ensure required directories exist
 */
function ensureDirectories(config: BrokerConfig): void {
  const socketDir = path.dirname(config.socketPath);
  const auditDir = path.dirname(config.auditLogPath);

  for (const dir of [socketDir, auditDir, config.policiesPath]) {
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
      } catch (error) {
        // Directory might be created by another process
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
          console.warn(`Warning: Could not create directory ${dir}:`, error);
        }
      }
    }
  }
}

/**
 * Ensure all proxied command wrappers exist in the agent's bin directory.
 * Prefers symlinks to shield-exec; falls back to bash wrapper scripts.
 */
function ensureProxiedCommandWrappers(binDir: string): void {
  if (!fs.existsSync(binDir)) {
    try {
      fs.mkdirSync(binDir, { recursive: true, mode: 0o755 });
    } catch {
      console.warn(`[broker] cannot create bin dir ${binDir}`);
      return;
    }
  }

  const shieldExecPath = '/opt/agenshield/bin/shield-exec';
  const hasShieldExec = fs.existsSync(shieldExecPath);
  let installed = 0;

  for (const cmd of PROXIED_COMMANDS) {
    const wrapperPath = path.join(binDir, cmd);
    if (fs.existsSync(wrapperPath)) continue;

    if (hasShieldExec) {
      try {
        fs.symlinkSync(shieldExecPath, wrapperPath);
        installed++;
        continue;
      } catch {
        // fall through to bash wrapper
      }
    }

    // Fallback: bash wrapper that routes through shield-client
    try {
      const script = [
        '#!/bin/bash',
        `# ${cmd} - AgenShield proxy (auto-generated)`,
        'if ! /bin/pwd > /dev/null 2>&1; then cd ~ 2>/dev/null || cd /; fi',
        `exec /opt/agenshield/bin/shield-client exec ${cmd} "$@"`,
        '',
      ].join('\n');
      fs.writeFileSync(wrapperPath, script, { mode: 0o755 });
      installed++;
    } catch {
      console.warn(`[broker] cannot write wrapper for ${cmd}`);
    }
  }

  if (installed > 0) {
    console.log(`[broker] installed ${installed} command wrappers in ${binDir}`);
  }
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  // Early diagnostics — always visible in logs even if config loading fails
  console.log(`AgenShield Broker starting at ${new Date().toISOString()}`);
  console.log(`PID: ${process.pid}, UID: ${process.getuid?.()}, GID: ${process.getgid?.()}`);
  console.log(`Node: ${process.version}, Platform: ${process.platform}`);
  console.log('========================');

  let config: BrokerConfig;
  try {
    config = loadConfig();
  } catch (err) {
    console.error('FATAL: Failed to load configuration:', err);
    process.exit(1);
  }

  console.log(`Config: ${config.configPath}`);
  console.log(`Socket: ${config.socketPath}`);
  console.log(`Socket owner: ${config.socketOwner}, group: ${config.socketGroup}`);
  console.log(`HTTP Fallback: ${config.httpEnabled ? `${config.httpHost}:${config.httpPort}` : 'disabled'}`);
  console.log(`Policies: ${config.policiesPath}`);
  console.log(`Agent Home: ${config.agentHome || '(env fallback)'}`);
  console.log(`Daemon URL: ${config.daemonUrl || '(default)'}`);
  console.log(`Log Level: ${config.logLevel}`);

  try {
    ensureDirectories(config);
  } catch (err) {
    console.error('FATAL: Failed to ensure directories:', err);
    process.exit(1);
  }

  // Initialize components
  const auditLogger = new AuditLogger({
    logPath: config.auditLogPath,
    logLevel: config.logLevel,
  });

  const policyEnforcer = new PolicyEnforcer({
    policiesPath: config.policiesPath,
    defaultPolicies: getDefaultPolicies({ agentHome: config.agentHome }),
    failOpen: config.failOpen,
  });

  const secretVault = new SecretVault({
    vaultPath: '/etc/agenshield/vault.enc',
  });

  const commandAllowlist = new CommandAllowlist(
    '/opt/agenshield/config/allowed-commands.json'
  );

  // Ensure proxied command wrappers exist in agent's bin directory
  if (config.agentHome) {
    ensureProxiedCommandWrappers(path.join(config.agentHome, 'bin'));
  }

  // Start Unix socket server
  const socketServer = new UnixSocketServer({
    config,
    policyEnforcer,
    auditLogger,
    secretVault,
    commandAllowlist,
  });

  await socketServer.start();
  console.log(`Unix socket server listening on ${config.socketPath}`);

  // Start HTTP fallback server if enabled
  let httpServer: HttpFallbackServer | null = null;
  if (config.httpEnabled) {
    httpServer = new HttpFallbackServer({
      config,
      policyEnforcer,
      auditLogger,
      commandAllowlist,
    });

    await httpServer.start();
    console.log(`HTTP fallback server listening on ${config.httpHost}:${config.httpPort}`);
  }

  // Handle shutdown signals
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\nReceived ${signal}, shutting down...`);

    await socketServer.stop();
    if (httpServer) {
      await httpServer.stop();
    }
    await auditLogger.close();

    console.log('Broker stopped.');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  console.log('\nBroker is running. Press Ctrl+C to stop.');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
