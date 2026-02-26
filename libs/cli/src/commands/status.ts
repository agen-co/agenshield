/**
 * Status command
 *
 * Shows the current AgenShield installation and security status.
 * Tries daemon API first for per-target info, falls back to local detection.
 */

import * as fs from 'node:fs';
import type { Command } from 'commander';
import { withGlobals } from './base.js';
import { getEffectiveEnvForScanning } from '../utils/sudo-env.js';
import { output } from '../utils/output.js';
import { ensureSetupComplete } from '../utils/setup-guard.js';
import { DAEMON_CONFIG, readAdminToken, fetchAdminToken } from '../utils/daemon.js';

const DAEMON_URL = `http://${DAEMON_CONFIG.HOST}:${DAEMON_CONFIG.PORT}`;

interface TargetInfo {
  id: string;
  name: string;
  type: string;
  shielded: boolean;
  running: boolean;
  version?: string;
  processes?: Array<{ pid: number; elapsed: string; command: string }>;
}

interface DaemonInfo {
  daemon: { version?: string; pid?: number; uptime?: number; cloudConnected?: boolean };
  targets: TargetInfo[];
  /** True when daemon is reachable but target data couldn't be fetched (auth failure) */
  targetsAuthRequired?: boolean;
}

/**
 * Try to fetch per-target status from the running daemon
 */
async function fetchDaemonStatus(): Promise<DaemonInfo | null> {
  // 1. Check health (public)
  try {
    const healthResp = await fetch(`${DAEMON_URL}/api/health`, { signal: AbortSignal.timeout(2000) });
    if (!healthResp.ok) return null;
  } catch {
    return null;
  }

  // 2. Fetch daemon info from /api/status (public)
  const daemon: DaemonInfo['daemon'] = {};
  try {
    const statusResp = await fetch(`${DAEMON_URL}/api/status`, { signal: AbortSignal.timeout(2000) });
    if (statusResp.ok) {
      const body = (await statusResp.json()) as {
        success?: boolean;
        data?: { version?: string; pid?: number; uptime?: number; cloudConnected?: boolean };
      };
      if (body.data) {
        daemon.version = body.data.version;
        daemon.pid = body.data.pid;
        daemon.uptime = body.data.uptime;
        daemon.cloudConnected = body.data.cloudConnected;
      }
    }
  } catch {
    // Non-fatal — we already confirmed health
  }

  // 3. Get admin token for authenticated endpoints
  const token = readAdminToken() ?? await fetchAdminToken();

  // 4. Fetch targets from /api/targets/lifecycle (requires auth)
  if (token) {
    try {
      const targetsResp = await fetch(`${DAEMON_URL}/api/targets/lifecycle`, {
        signal: AbortSignal.timeout(5000),
        headers: { Authorization: `Bearer ${token}` },
      });
      if (targetsResp.ok) {
        const body = (await targetsResp.json()) as { success?: boolean; data?: TargetInfo[] };
        return { daemon, targets: body.data ?? [] };
      }
    } catch {
      // Auth or network error — fall through to degraded mode
    }
  }

  // 5. Daemon reachable but targets unavailable (no token or auth failed)
  return { daemon, targets: [], targetsAuthRequired: !token };
}

/**
 * Show per-target status from daemon
 */
async function showDaemonStatusInfo(daemonInfo: DaemonInfo): Promise<void> {
  const { checkSecurityStatus } = await import('@agenshield/sandbox');

  const ver = daemonInfo.daemon.version ? ` (v${daemonInfo.daemon.version})` : '';
  const pid = daemonInfo.daemon.pid ? `, PID ${daemonInfo.daemon.pid}` : '';
  output.info(`Daemon:       ${output.green('\u2713')} Running${ver}${pid}`);

  const targets = daemonInfo.targets;
  if (targets.length > 0) {
    output.info('\nTargets:');
    for (const t of targets) {
      output.info(`  ${t.name}:`);
      output.info(`    Isolation:    ${t.shielded ? `${output.green('\u2713')} Shielded` : '\u25CB Not shielded'}`);

      if (t.shielded) {
        const processCount = t.processes?.length ?? 0;
        const runLabel = t.running
          ? `${output.green('\u2713')} Running${processCount > 0 ? ` (${processCount} process${processCount !== 1 ? 'es' : ''})` : ''}`
          : '\u25CB Stopped';
        output.info(`    Status:       ${runLabel}`);
      }
    }
  } else if (daemonInfo.targetsAuthRequired) {
    output.info(`\nTargets:      ${output.yellow('\u26A0')} Auth required - run "agenshield auth" to authenticate`);
  } else {
    output.info('\nTargets:      (none)');
  }

  const security = await checkSecurityStatus({ env: getEffectiveEnvForScanning(), callerRole: 'daemon' });
  output.info(
    `\nSecrets:      ${security.exposedSecrets.length === 0 ? '\u2713 Protected' : `\u26A0 ${security.exposedSecrets.length} exposed`}`,
  );

  output.info('\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
  if (security.critical.length > 0) {
    output.info('Status: \u26D4 CRITICAL - Immediate action required');
  } else if (targets.length > 0 && targets.every((t) => t.shielded)) {
    output.info('Status: \u2705 SECURE');
  } else if (targets.length > 0) {
    output.info('Status: \u26A0 PARTIAL - Not all targets shielded');
  } else {
    output.info('Status: \u26A0 UNPROTECTED - Run "agenshield start"');
  }
}

/**
 * Fallback: show status from local system scanning
 */
async function showLocalStatus(): Promise<void> {
  const { listAgenshieldUsers, guardedShellPath, checkSecurityStatus } =
    await import('@agenshield/sandbox');

  output.info('Daemon:       \u2717 Not running\n');

  const users = listAgenshieldUsers();
  const agents = users.filter((u) => u.username.endsWith('_agent'));

  if (agents.length > 0) {
    output.info('Targets (local scan):');
    for (const agent of agents) {
      const target = agent.username.replace(/^ash_/, '').replace(/_agent$/, '');
      const agentHome = `/Users/${agent.username}`;
      const shellPath = guardedShellPath(agentHome);
      const hasShell = fs.existsSync(shellPath);
      output.info(`  ${target}:`);
      output.info(`    Sandbox User: \u2713 ${agent.username}`);
      output.info(`    Shell:        ${hasShell ? '\u2713 Guarded' : '\u25CB Not installed'}`);
    }
  } else {
    output.info('Targets:      (none found)');
  }

  const security = await checkSecurityStatus({ env: getEffectiveEnvForScanning() });
  output.info(
    `\nSecrets:      ${security.exposedSecrets.length === 0 ? '\u2713 Protected' : `\u26A0 ${security.exposedSecrets.length} exposed`}`,
  );

  output.info('\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
  if (security.critical.length > 0) {
    output.info('Status: \u26D4 CRITICAL - Immediate action required');
  } else if (agents.length > 0 && security.isIsolated) {
    output.info('Status: \u2705 SECURE');
  } else if (agents.length > 0) {
    output.info('Status: \u26A0 PARTIAL - Run "agenshield start" to complete');
  } else {
    output.info('Status: \u26A0 UNPROTECTED - Run "agenshield start"');
  }
}

/**
 * Show the current status (daemon-first, local fallback)
 */
async function showStatus(): Promise<void> {
  output.info('AgenShield Status');
  output.info('=================\n');

  const daemonStatus = await fetchDaemonStatus();
  if (daemonStatus) {
    await showDaemonStatusInfo(daemonStatus);
  } else {
    await showLocalStatus();
  }
}

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show current AgenShield status')
    .action(withGlobals(async (opts) => {
      ensureSetupComplete();
      if (opts['json']) {
        const { checkSecurityStatus } = await import('@agenshield/sandbox');
        const daemonStatus = await fetchDaemonStatus();
        const security = await checkSecurityStatus({ env: getEffectiveEnvForScanning() });
        output.data({
          daemon: daemonStatus?.daemon ?? null,
          targets: daemonStatus?.targets ?? [],
          security,
        });
      } else {
        await showStatus();
      }
    }));
}
