/**
 * Upgrade command
 *
 * Dual-path upgrade logic:
 *  - Local install (~/.agenshield/dist/) → npm-pack download with rollback
 *  - Legacy (global npm / monorepo)      → stop + update engine + restart
 */

import { Command } from 'commander';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { stopDaemon, startDaemon, getDaemonStatus, DAEMON_CONFIG } from '../utils/daemon.js';
import {
  isLocalInstall,
  readVersionInfo,
  writeVersionInfo,
  getDistDir,
  queryLatestVersion,
  downloadAndExtract,
  installFromLocal,
  findMonorepoRoot,
  writeShim,
  getLocalCliEntry,
} from '../utils/home.js';
import { runUpdate } from './update.js';

// ---------------------------------------------------------------------------
// Local-install upgrade (npm pack flow with rollback)
// ---------------------------------------------------------------------------

async function upgradeLocalInstall(options: {
  force?: boolean;
  verbose?: boolean;
  local?: boolean;
}): Promise<void> {
  const versionInfo = readVersionInfo();
  if (!versionInfo) {
    console.log('  \x1b[31m✗ version.json is missing or corrupt. Run `agenshield install --force`.\x1b[0m');
    process.exit(1);
  }

  const currentVersion = versionInfo.version;
  console.log(`  Current version: ${currentVersion}`);

  let targetVersion: string;

  if (options.local) {
    // Local upgrade: read version from monorepo
    const repoRoot = findMonorepoRoot();
    if (!repoRoot) {
      console.log('  \x1b[31m✗ Could not find monorepo root (no package.json with workspaces field).\x1b[0m');
      process.exit(1);
    }

    try {
      const cliPkg = JSON.parse(
        fs.readFileSync(path.join(repoRoot, 'libs', 'cli', 'package.json'), 'utf-8'),
      );
      targetVersion = cliPkg.version || 'unknown';
    } catch {
      targetVersion = 'unknown';
    }

    console.log(`  Local version:   ${targetVersion}`);
  } else {
    // Query latest from npm
    console.log('  Checking npm registry for latest version...');
    try {
      targetVersion = queryLatestVersion();
    } catch (err) {
      console.log(`  \x1b[31m✗ Failed to query npm registry: ${(err as Error).message}\x1b[0m`);
      process.exit(1);
    }

    console.log(`  Latest version:  ${targetVersion}`);
  }

  if (currentVersion === targetVersion && !options.force) {
    console.log('');
    console.log(`  \x1b[32m✓\x1b[0m Already at latest version (${currentVersion}).`);
    console.log('  Use --force to re-download.');
    return;
  }

  // Stop daemon if running
  const wasDaemonRunning = (await getDaemonStatus()).running;
  if (wasDaemonRunning) {
    console.log('  Stopping daemon...');
    const stopResult = await stopDaemon();
    if (!stopResult.success && stopResult.message !== 'Daemon is not running') {
      console.log(`  \x1b[31m✗ ${stopResult.message}\x1b[0m`);
      process.exit(1);
    }
    console.log(`  \x1b[32m✓\x1b[0m ${stopResult.message}`);
  }

  const distDir = getDistDir();
  let result: { success: boolean; version: string; error?: string };

  if (options.local) {
    // Local upgrades: dist is a symlink — just re-symlink (no backup needed)
    const repoRoot = findMonorepoRoot()!;
    console.log(`  Installing agenshield@${targetVersion} from local build...`);
    result = installFromLocal(repoRoot);
  } else {
    // npm upgrades: backup current dist, download, rollback on failure
    const backupDir = `${distDir}.bak`;

    if (fs.existsSync(backupDir)) {
      fs.rmSync(backupDir, { recursive: true, force: true });
    }

    console.log('  Backing up current installation...');
    fs.renameSync(distDir, backupDir);
    fs.mkdirSync(distDir, { recursive: true });

    console.log(`  Downloading agenshield@${targetVersion}...`);
    result = downloadAndExtract(targetVersion);

    if (!result.success) {
      console.log(`  \x1b[31m✗ Install failed: ${result.error}\x1b[0m`);
      console.log('  Rolling back to previous version...');
      fs.rmSync(distDir, { recursive: true, force: true });
      fs.renameSync(backupDir, distDir);
      console.log('  \x1b[32m✓\x1b[0m Rolled back successfully.');

      if (wasDaemonRunning) {
        console.log('  Restarting daemon with previous version...');
        await startDaemon();
      }
      process.exit(1);
    }

    // Verify entry point (npm path only — local symlink resolves through monorepo)
    const cliEntry = getLocalCliEntry();
    if (!fs.existsSync(cliEntry)) {
      console.log(`  \x1b[31m✗ CLI entry point not found at ${cliEntry}\x1b[0m`);
      console.log('  Rolling back to previous version...');
      fs.rmSync(distDir, { recursive: true, force: true });
      fs.renameSync(backupDir, distDir);
      console.log('  \x1b[32m✓\x1b[0m Rolled back successfully.');

      if (wasDaemonRunning) {
        console.log('  Restarting daemon with previous version...');
        await startDaemon();
      }
      process.exit(1);
    }

    // Remove backup
    fs.rmSync(backupDir, { recursive: true, force: true });
  }

  if (!result.success) {
    console.log(`  \x1b[31m✗ Install failed: ${result.error}\x1b[0m`);
    if (wasDaemonRunning) {
      console.log('  Restarting daemon with previous version...');
      await startDaemon();
    }
    process.exit(1);
  }

  console.log(`  \x1b[32m✓\x1b[0m Installed agenshield@${targetVersion}`);

  // Regenerate shim and update version.json
  writeShim();
  writeVersionInfo({
    ...versionInfo,
    version: targetVersion,
    updatedAt: new Date().toISOString(),
  });
  console.log(`  \x1b[32m✓\x1b[0m Updated version.json (${currentVersion} → ${targetVersion})`);

  // Restart daemon if it was running
  if (wasDaemonRunning) {
    console.log('  Restarting daemon...');
    const startResult = await startDaemon();
    if (startResult.success) {
      const url = `http://${DAEMON_CONFIG.DISPLAY_HOST}:${DAEMON_CONFIG.PORT}`;
      console.log(`  \x1b[32m✓\x1b[0m ${startResult.message}`);
      console.log(`  URL: ${url}`);
    } else {
      console.log(`  \x1b[31m✗ ${startResult.message}\x1b[0m`);
    }
  }

  console.log('');
  console.log(`  \x1b[32m✓ Upgrade complete!\x1b[0m (${currentVersion} → ${targetVersion})`);
}

// ---------------------------------------------------------------------------
// Legacy upgrade (stop → update engine → restart)
// ---------------------------------------------------------------------------

async function upgradeLegacy(options: {
  dryRun?: boolean;
  verbose?: boolean;
  force?: boolean;
  cli?: boolean;
}): Promise<void> {
  const wasDaemonRunning = (await getDaemonStatus()).running;

  // Stop daemon before upgrade
  if (wasDaemonRunning && !options.dryRun) {
    console.log('Stopping daemon before upgrade...');
    const stopResult = await stopDaemon();
    if (!stopResult.success && stopResult.message !== 'Daemon is not running') {
      console.log(`\x1b[31m✗ ${stopResult.message}\x1b[0m`);
      process.exit(1);
    }
    console.log(`\x1b[32m✓ ${stopResult.message}\x1b[0m`);
    console.log('');
  }

  // Run the update logic (reuses the full update engine)
  await runUpdate({
    dryRun: options.dryRun,
    verbose: options.verbose,
    force: options.force,
    cli: options.cli,
  });

  // Restart daemon after upgrade (update engine may have already started it,
  // so check first)
  if (!options.dryRun) {
    const status = await getDaemonStatus();
    if (!status.running) {
      console.log('Restarting daemon...');
      const startResult = await startDaemon();
      if (startResult.success) {
        const url = `http://${DAEMON_CONFIG.DISPLAY_HOST}:${DAEMON_CONFIG.PORT}`;
        console.log(`\x1b[32m✓ ${startResult.message}\x1b[0m`);
        console.log(`  URL: ${url}`);
      } else {
        console.log(`\x1b[31m✗ ${startResult.message}\x1b[0m`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Command definition
// ---------------------------------------------------------------------------

/**
 * Create the upgrade command
 */
export function createUpgradeCommand(): Command {
  const cmd = new Command('upgrade')
    .description('Upgrade AgenShield (stop, update, restart)')
    .option('--dry-run', 'Show what would be done without making changes')
    .option('-v, --verbose', 'Show verbose output')
    .option('--force', 'Re-apply even if already at latest version')
    .option('--local', 'Upgrade from local monorepo build output instead of npm')
    .option('--cli', 'Use terminal mode instead of web browser')
    .action(async (options) => {
      if (isLocalInstall()) {
        // New npm-pack based upgrade for local installations
        console.log('');
        console.log('  AgenShield Upgrade (local install)');
        console.log('  ──────────────────────────────────');
        console.log('');
        await upgradeLocalInstall({
          force: options.force,
          verbose: options.verbose,
          local: options.local,
        });
      } else {
        // Legacy: update-engine based upgrade
        await upgradeLegacy({
          dryRun: options.dryRun,
          verbose: options.verbose,
          force: options.force,
          cli: options.cli,
        });
      }
    });

  return cmd;
}
