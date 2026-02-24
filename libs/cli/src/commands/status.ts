/**
 * Status command
 *
 * Shows the current AgenShield installation and security status.
 * Tries daemon API first for per-target info, falls back to local detection.
 */

import * as fs from 'node:fs';
import { Command } from 'commander';
import { getEffectiveEnvForScanning } from '../utils/sudo-env.js';

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
async function showDaemonStatus(
  daemonInfo: NonNullable<Awaited<ReturnType<typeof fetchDaemonStatus>>>,
): Promise<void> {
  const { checkSecurityStatus } = await import('@agenshield/sandbox');

  const ver = daemonInfo.daemon.version ? ` (v${daemonInfo.daemon.version})` : '';
  const pid = daemonInfo.daemon.pid ? `, PID ${daemonInfo.daemon.pid}` : '';
  console.log(`Daemon:       ✓ Running${ver}${pid}`);

  const profiles = daemonInfo.profiles;
  if (profiles.length > 0) {
    console.log('\nTargets:');
    for (const p of profiles) {
      const target = p.targetName ?? p.name;
      console.log(`  ${target}:`);

      // Sandbox user
      const agent = p.agentUsername;
      console.log(`    Sandbox User: ${agent ? `✓ ${agent}` : '✗ Not created'}`);

      // Isolation
      console.log(`    Isolation:    ${p.shielded ? '✓ Active' : '○ Not active'}`);

      // Guarded shell (per-target check)
      if (p.agentHomeDir) {
        const shellPath = `${p.agentHomeDir}/.agenshield/bin/guarded-shell`;
        const hasShell = fs.existsSync(shellPath);
        console.log(`    Shell:        ${hasShell ? '✓ Guarded' : '○ Not installed'}`);
      }
    }
  } else {
    console.log('\nTargets:      (none)');
  }

  // Secrets check
  const security = checkSecurityStatus({ env: getEffectiveEnvForScanning(), callerRole: 'daemon' });
  console.log(
    `\nSecrets:      ${security.exposedSecrets.length === 0 ? '✓ Protected' : `⚠ ${security.exposedSecrets.length} exposed`}`,
  );

  // Overall
  console.log('\n─────────────────────');
  if (security.critical.length > 0) {
    console.log('Status: ⛔ CRITICAL - Immediate action required');
  } else if (profiles.length > 0 && profiles.every((p) => p.shielded)) {
    console.log('Status: ✅ SECURE');
  } else if (profiles.length > 0) {
    console.log('Status: ⚠ PARTIAL - Not all targets shielded');
  } else {
    console.log('Status: ⚠ UNPROTECTED - Run "agenshield start"');
  }
}

/**
 * Fallback: show status from local system scanning
 */
async function showLocalStatus(): Promise<void> {
  const { listAgenshieldUsers, guardedShellPath, checkSecurityStatus } =
    await import('@agenshield/sandbox');

  console.log('Daemon:       ✗ Not running\n');

  const users = listAgenshieldUsers();
  const agents = users.filter((u) => u.username.endsWith('_agent'));

  if (agents.length > 0) {
    console.log('Targets (local scan):');
    for (const agent of agents) {
      const target = agent.username.replace(/^ash_/, '').replace(/_agent$/, '');
      const agentHome = `/Users/${agent.username}`;
      const shellPath = guardedShellPath(agentHome);
      const hasShell = fs.existsSync(shellPath);
      console.log(`  ${target}:`);
      console.log(`    Sandbox User: ✓ ${agent.username}`);
      console.log(`    Shell:        ${hasShell ? '✓ Guarded' : '○ Not installed'}`);
    }
  } else {
    console.log('Targets:      (none found)');
  }

  const security = checkSecurityStatus({ env: getEffectiveEnvForScanning() });
  console.log(
    `\nSecrets:      ${security.exposedSecrets.length === 0 ? '✓ Protected' : `⚠ ${security.exposedSecrets.length} exposed`}`,
  );

  console.log('\n─────────────────────');
  if (security.critical.length > 0) {
    console.log('Status: ⛔ CRITICAL - Immediate action required');
  } else if (agents.length > 0 && security.isIsolated) {
    console.log('Status: ✅ SECURE');
  } else if (agents.length > 0) {
    console.log('Status: ⚠ PARTIAL - Run "agenshield start" to complete');
  } else {
    console.log('Status: ⚠ UNPROTECTED - Run "agenshield start"');
  }
}

/**
 * Show the current status (daemon-first, local fallback)
 */
async function showStatus(): Promise<void> {
  console.log('AgenShield Status');
  console.log('=================\n');

  const daemonStatus = await fetchDaemonStatus();
  if (daemonStatus) {
    await showDaemonStatus(daemonStatus);
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
      if (options.json) {
        const { checkSecurityStatus } = await import('@agenshield/sandbox');
        const daemonStatus = await fetchDaemonStatus();
        const security = checkSecurityStatus({ env: getEffectiveEnvForScanning() });
        console.log(JSON.stringify({ daemon: daemonStatus, security }, null, 2));
      } else {
        await showStatus();
      }
    });

  return cmd;
}
