/**
 * Setup command — interactive guided flow
 *
 * Running `agenshield setup` walks the user through:
 *   1. Choosing local vs cloud mode
 *   2. Mode-specific configuration and daemon start
 *   3. Persisting setup state so other commands know setup is complete
 *
 * Options `--mode` and `--cloud-url` allow skipping prompts for CI / scripting.
 */

import type { Command } from 'commander';
import * as os from 'node:os';
import { withGlobals } from './base.js';
import {
  getDaemonStatus,
  startDaemon,
  readAdminToken,
  fetchAdminToken,
} from '../utils/daemon.js';
import { buildBrowserUrl, waitForAdminToken } from '../utils/browser.js';
import { ensureSudoAccess, startSudoKeepalive } from '../utils/privileges.js';
import { output } from '../utils/output.js';
import { createSpinner } from '../utils/spinner.js';
import { DaemonStartError, ConnectionError, AuthError } from '../errors.js';
import { writeSetupState, readSetupState } from '../utils/setup-state.js';
import {
  initiateDeviceCode,
  pollDeviceCode,
  generateEd25519Keypair,
  registerDevice,
  saveCloudCredentials,
  isCloudEnrolled,
  CLOUD_CONFIG,
} from '../utils/cloud.js';
import { inkSelect, inkInput, inkBrowserLink } from '../prompts/index.js';

// ---------------------------------------------------------------------------
// Local setup flow
// ---------------------------------------------------------------------------

async function runLocalSetup(): Promise<void> {
  output.info('');
  output.info(`  ${output.bold('Local Setup')}`);
  output.info('');

  // 1. Ensure sudo access
  ensureSudoAccess();

  // 2. Check if daemon is already running
  const status = await getDaemonStatus();

  if (status.running) {
    const token = readAdminToken() ?? await fetchAdminToken();
    const url = buildBrowserUrl(token);

    output.success(`Daemon is already running (PID: ${status.pid ?? 'unknown'})`);
    output.info('');

    // Persist setup state
    writeSetupState({ mode: 'local', completedAt: new Date().toISOString() });

    await inkBrowserLink({ url, label: 'Dashboard', token: token ?? undefined });
    output.info('');
    output.success('Setup complete!');
    return;
  }

  // 3. Start daemon
  const spinner = await createSpinner('Starting daemon...');
  const result = await startDaemon({ sudo: true });

  if (!result.success) {
    spinner.fail('Failed to start daemon');
    throw new DaemonStartError(result.message);
  }

  // 4. Wait for admin token
  spinner.update('Waiting for authorization...');
  const token = await waitForAdminToken();
  const url = buildBrowserUrl(token);

  spinner.succeed(`Daemon started${result.pid ? ` (PID: ${result.pid})` : ''}`);
  output.info('');

  // 5. Persist setup state
  writeSetupState({ mode: 'local', completedAt: new Date().toISOString() });

  await inkBrowserLink({ url, label: 'Dashboard', token: token ?? undefined });
  output.info('');
  output.success('Setup complete!');
}

// ---------------------------------------------------------------------------
// Cloud setup flow
// ---------------------------------------------------------------------------

async function runCloudSetup(options: { cloudUrl: string }): Promise<void> {
  output.info('');
  output.info(`  ${output.bold('Cloud Setup')}`);
  output.info('');

  // Check if already enrolled
  if (isCloudEnrolled()) {
    output.warn('This device is already enrolled in AgenShield Cloud.');
    output.info('  To re-enroll, remove ~/.agenshield/cloud.json first.');
    output.info('');
    return;
  }

  const cloudUrl = options.cloudUrl;

  // 1. Ensure sudo access (needed to start daemon later)
  ensureSudoAccess();
  const sudoKeepalive = startSudoKeepalive();

  try {
    // 2. Initiate device code flow
    output.info('  Contacting AgenShield Cloud...');
    let deviceCode: Awaited<ReturnType<typeof initiateDeviceCode>>;
    try {
      deviceCode = await initiateDeviceCode(cloudUrl);
    } catch (err) {
      throw new ConnectionError(`Failed to contact cloud: ${(err as Error).message}`);
    }

    // 3. Display verification instructions and offer to open browser
    output.info('');
    await inkBrowserLink({ url: deviceCode.verificationUri, label: 'Authorize this device' });
    output.info(`  ${output.dim(`Code: ${deviceCode.userCode}`)}`);
    output.info('');

    // 4. Poll for authorization
    const spinner = await createSpinner('Waiting for authorization...');
    const pollResult = await pollDeviceCode(
      cloudUrl,
      deviceCode.deviceCode,
      deviceCode.interval,
    );

    if (pollResult.status !== 'approved') {
      spinner.fail('Authorization failed');
      throw new AuthError(`Authorization ${pollResult.status}: ${pollResult.error || 'Device code was not approved'}`);
    }

    spinner.succeed(`Authorized by ${pollResult.companyName || 'your organization'}`);
    output.info('');

    // 5. Generate Ed25519 keypair
    output.info('  Generating device keypair...');
    const keypair = generateEd25519Keypair();

    // 6. Register device with cloud
    output.info('  Registering device...');
    const registration = await registerDevice(
      cloudUrl,
      pollResult.enrollmentToken!,
      keypair.publicKey,
      os.hostname(),
    );

    // 7. Save credentials locally
    saveCloudCredentials(
      registration.agentId,
      keypair.privateKey,
      cloudUrl,
      pollResult.companyName || 'Unknown',
    );

    output.success(`Device registered (ID: ${registration.agentId})`);
    output.info('');

    // Persist setup state immediately — enrollment is the critical part.
    // Daemon start is best-effort from here.
    writeSetupState({
      mode: 'cloud',
      cloudUrl,
      completedAt: new Date().toISOString(),
    });

    // 8. Start daemon (best-effort — don't throw on failure)
    const daemonStatus = await getDaemonStatus();
    if (!daemonStatus.running) {
      const daemonSpinner = await createSpinner('Starting daemon...');
      const daemonResult = await startDaemon({ sudo: true });
      if (!daemonResult.success) {
        daemonSpinner.fail(daemonResult.message);
        output.warn('Cloud enrollment succeeded, but the daemon failed to start.');
        output.info('  Run `agenshield start` to start it manually.');
        output.info('');
        output.success('Cloud setup complete!');
        output.info(`  Company: ${pollResult.companyName || 'Unknown'}`);
        return;
      }
      daemonSpinner.succeed('Daemon started');
    }

    // 9. Open dashboard (only if daemon started)
    const adminToken = await waitForAdminToken();
    const url = buildBrowserUrl(adminToken);

    output.info('');
    output.success('Cloud setup complete!');
    output.info(`  Company: ${pollResult.companyName || 'Unknown'}`);
    await inkBrowserLink({ url, label: 'Dashboard' });
    output.info('');
  } finally {
    clearInterval(sudoKeepalive);
  }
}

// ---------------------------------------------------------------------------
// Command definition
// ---------------------------------------------------------------------------

export function registerSetupCommand(program: Command): void {
  program
    .command('setup')
    .description('Set up AgenShield (interactive guided flow)')
    .option('--mode <mode>', 'Skip mode prompt: "local" or "cloud"')
    .option('--cloud-url <url>', 'Cloud API URL (skips prompt, implies --mode cloud)')
    .action(withGlobals(async (opts) => {
      output.info('');
      output.info(`  ${output.bold('Welcome to AgenShield Setup')}`);
      output.info('');

      const existing = readSetupState();
      if (existing) {
        output.info(`  ${output.dim(`Previously set up in ${existing.mode} mode (${existing.completedAt})`)}`);
        output.info('');
      }

      // Determine mode: from flag, from --cloud-url, or interactively
      let mode: string;

      if (opts['cloudUrl']) {
        mode = 'cloud';
      } else if (opts['mode']) {
        mode = opts['mode'] as string;
      } else {
        const selected = await inkSelect([
          { label: 'Local', value: 'local' as const, description: 'Run AgenShield locally on this machine' },
          { label: 'Cloud', value: 'cloud' as const, description: 'Connect to AgenShield Cloud for centralized management' },
        ], { title: 'Choose Setup Mode' });
        if (!selected) {
          output.info('Setup cancelled.');
          return;
        }
        mode = selected;
      }

      if (mode === 'local') {
        await runLocalSetup();
      } else if (mode === 'cloud') {
        // Determine cloud URL: from flag or interactively
        let cloudUrl: string;
        if (opts['cloudUrl']) {
          cloudUrl = opts['cloudUrl'] as string;
        } else {
          const inputUrl = await inkInput({ prompt: 'Cloud URL', defaultValue: CLOUD_CONFIG.url });
          if (inputUrl === null) {
            output.info('Setup cancelled.');
            return;
          }
          cloudUrl = inputUrl;
        }

        await runCloudSetup({ cloudUrl });
      } else {
        output.error(`Unknown mode: "${mode}". Use "local" or "cloud".`);
        process.exitCode = 2;
      }
    }));
}
