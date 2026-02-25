/**
 * Status command
 *
 * Shows the current AgenShield installation and security status.
 * Tries daemon API first for per-target info, falls back to local detection.
 */

import * as fs from 'node:fs';
import { Command } from 'commander';
import { getEffectiveEnvForScanning } from '../utils/sudo-env.js';
import { output } from '../utils/output.js';
import { ensureSetupComplete } from '../utils/setup-guard.js';

const DAEMON_URL = 'http://127.0.0.1:5200';

/**
 * Try to fetch per-target status from the running daemon
 */
async function fetchDaemonStatus(): Promise<{
  daemon: { version?: string; pid?: number };
  profiles: Array<{
    id: string;
    name: string;
    targetName?: string;
    agentUsername?: string;
    agentHomeDir?: string;
    shielded?: boolean;
  }>;
} | null> {
  try {
    const healthResp = await fetch(`${DAEMON_URL}/api/health`, { signal: AbortSignal.timeout(2000) });
    if (!healthResp.ok) return null;
    const health = (await healthResp.json()) as Record<string, unknown>;

    const profilesResp = await fetch(`${DAEMON_URL}/api/profiles`, { signal: AbortSignal.timeout(2000) });
    const profilesBody = profilesResp.ok
      ? ((await profilesResp.json()) as { data?: unknown[] })
      : { data: [] };

    return {
      daemon: {
        version: String(health['version'] ?? ''),
        pid: typeof health['pid'] === 'number' ? health['pid'] : undefined,
      },
      profiles: (profilesBody.data ?? []) as Array<{
        id: string;
        name: string;
        targetName?: string;
        agentUsername?: string;
        agentHomeDir?: string;
        shielded?: boolean;
      }>,
    };
  } catch {
    return null;
  }
}

/**
 * Show per-target status from daemon
 */
async function showDaemonStatusInfo(
  daemonInfo: NonNullable<Awaited<ReturnType<typeof fetchDaemonStatus>>>,
): Promise<void> {
  const { checkSecurityStatus } = await import('@agenshield/sandbox');

  const ver = daemonInfo.daemon.version ? ` (v${daemonInfo.daemon.version})` : '';
  const pid = daemonInfo.daemon.pid ? `, PID ${daemonInfo.daemon.pid}` : '';
  output.info(`Daemon:       ${output.green('\u2713')} Running${ver}${pid}`);

  const profiles = daemonInfo.profiles;
  if (profiles.length > 0) {
    output.info('\nTargets:');
    for (const p of profiles) {
      const target = p.targetName ?? p.name;
      output.info(`  ${target}:`);

      const agent = p.agentUsername;
      output.info(`    Sandbox User: ${agent ? `\u2713 ${agent}` : '\u2717 Not created'}`);
      output.info(`    Isolation:    ${p.shielded ? '\u2713 Active' : '\u25CB Not active'}`);

      if (p.agentHomeDir) {
        const shellPath = `${p.agentHomeDir}/.agenshield/bin/guarded-shell`;
        const hasShell = fs.existsSync(shellPath);
        output.info(`    Shell:        ${hasShell ? '\u2713 Guarded' : '\u25CB Not installed'}`);
      }
    }
  } else {
    output.info('\nTargets:      (none)');
  }

  const security = checkSecurityStatus({ env: getEffectiveEnvForScanning(), callerRole: 'daemon' });
  output.info(
    `\nSecrets:      ${security.exposedSecrets.length === 0 ? '\u2713 Protected' : `\u26A0 ${security.exposedSecrets.length} exposed`}`,
  );

  output.info('\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
  if (security.critical.length > 0) {
    output.info('Status: \u26D4 CRITICAL - Immediate action required');
  } else if (profiles.length > 0 && profiles.every((p) => p.shielded)) {
    output.info('Status: \u2705 SECURE');
  } else if (profiles.length > 0) {
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

  const security = checkSecurityStatus({ env: getEffectiveEnvForScanning() });
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

/**
 * Create the status command
 */
export function createStatusCommand(): Command {
  const cmd = new Command('status')
    .description('Show current AgenShield status')
    .option('-j, --json', 'Output as JSON')
    .action(async (options) => {
      ensureSetupComplete();
      if (options.json) {
        const { checkSecurityStatus } = await import('@agenshield/sandbox');
        const daemonStatus = await fetchDaemonStatus();
        const security = checkSecurityStatus({ env: getEffectiveEnvForScanning() });
        output.data({ daemon: daemonStatus, security });
      } else {
        await showStatus();
      }
    });

  return cmd;
}
