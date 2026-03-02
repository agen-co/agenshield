/**
 * Setup command — interactive guided flow
 *
 * Running `agenshield setup` walks the user through:
 *   1. Choosing local vs cloud mode
 *   2. Mode-specific configuration and daemon start
 *   3. Persisting setup state so other commands know setup is complete
 *
 * Options `--mode` and `--cloud-url` allow skipping prompts for CI / scripting.
 * Option  `--token` enables non-interactive MDM enrollment with a pre-generated token.
 */

import type { Command } from 'commander';
import * as os from 'node:os';
import { withGlobals } from './base.js';
import {
  getDaemonStatus,
  startDaemon,
  readAdminToken,
  fetchAdminToken,
  findDaemonExecutable,
  DAEMON_CONFIG,
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
import { saveMdmConfig } from '@agenshield/auth';
import { installDaemonService, installPrivilegeHelperService } from '@agenshield/integrations';
import { inkSelect, inkInput, inkBrowserLink } from '../prompts/index.js';

// ---------------------------------------------------------------------------
// Shield ASCII logo
// ---------------------------------------------------------------------------

function printShieldLogo(): void {
  const b = (s: string) => output.bold(output.green(s));

  const lines = [
    '   ___                       _____  _      _        _      _ ',
    '  / _ \\                     /  ___|| |    (_)      | |    | |',
    ' / /_\\ \\  __ _   ___  _ __  \\ `--. | |__   _   ___ | |  __| |',
    ' |  _  | / _` | / _ \\| \'_ \\  `--. \\| \'_ \\ | | / _ \\| | / _` |',
    ' | | | || (_| ||  __/| | | |/\\__/ /| | | || ||  __/| || (_| |',
    ' \\_| |_/ \\__, | \\___||_| |_|\\____/ |_| |_||_| \\___||_| \\__,_|',
    '          __/ |',
    '         |___/',
  ];

  output.info('');
  for (const line of lines) {
    output.info(b(line));
  }
  output.info('');
}

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
// Token-based setup flow (MDM / non-interactive)
// ---------------------------------------------------------------------------

async function runTokenSetup(options: { cloudUrl: string; token: string }): Promise<void> {
  output.info('');
  output.info(`  ${output.bold('Cloud Setup (Token)')}`);
  output.info('');

  // Check if already enrolled
  if (isCloudEnrolled()) {
    output.warn('This device is already enrolled in AgenShield Cloud.');
    output.info('  To re-enroll, remove ~/.agenshield/cloud.json first.');
    output.info('');
    return;
  }

  const { cloudUrl, token } = options;

  // 1. Generate Ed25519 keypair
  const keypairSpinner = await createSpinner('Generating device keypair...');
  const keypair = generateEd25519Keypair();
  keypairSpinner.succeed('Device keypair generated');

  // 2. Register device with cloud using the enrollment token directly
  const registerSpinner = await createSpinner('Registering device...');
  let registration: Awaited<ReturnType<typeof registerDevice>>;
  try {
    registration = await registerDevice(
      cloudUrl,
      token,
      keypair.publicKey,
      os.hostname(),
    );
  } catch (err) {
    registerSpinner.fail('Registration failed');
    throw new ConnectionError(`Failed to register device: ${(err as Error).message}`);
  }
  registerSpinner.succeed(`Device registered (ID: ${registration.agentId})`);

  // 3. Save credentials locally
  saveCloudCredentials(
    registration.agentId,
    keypair.privateKey,
    cloudUrl,
    'MDM',
  );

  // 4. Persist setup state
  writeSetupState({
    mode: 'cloud',
    cloudUrl,
    completedAt: new Date().toISOString(),
  });

  output.info('');

  // 5. Auto-install LaunchDaemon service (macOS)
  if (process.platform === 'darwin') {
    const serviceSpinner = await createSpinner('Installing daemon service...');
    const daemonPath = findDaemonExecutable();

    if (daemonPath) {
      const serviceResult = installDaemonService({
        daemonPath,
        port: DAEMON_CONFIG.PORT,
        host: DAEMON_CONFIG.HOST,
      });

      if (serviceResult.success) {
        // Also install privilege helper
        const helperResult = installPrivilegeHelperService({
          daemonPath,
          userHome: os.homedir(),
        });
        if (helperResult.success) {
          serviceSpinner.succeed('Services installed (daemon + privilege helper)');
        } else {
          serviceSpinner.succeed('Daemon service installed (LaunchDaemon)');
          output.warn(`Privilege helper: ${helperResult.message}`);
        }
      } else {
        serviceSpinner.fail(serviceResult.message);
        if (serviceResult.message.includes('Operation not permitted')) {
          output.warn('Installing a LaunchDaemon requires administrator privileges. Run with sudo.');
        }
        output.info('  Run `sudo agenshield service install` to install manually.');
      }
    } else {
      serviceSpinner.fail('Daemon executable not found — skipping service install');
      output.info('  Run `agenshield service install` after the daemon binary is available.');
    }
  }

  // 6. Start daemon (best-effort)
  const daemonStatus = await getDaemonStatus();
  if (!daemonStatus.running) {
    const daemonSpinner = await createSpinner('Starting daemon...');
    const daemonResult = await startDaemon({ sudo: true });
    if (!daemonResult.success) {
      daemonSpinner.fail(daemonResult.message);
      output.warn('Cloud enrollment succeeded, but the daemon failed to start.');
      output.info('  Run `agenshield start` to start it manually.');
      output.info('');
      output.success('Cloud setup complete (token)!');
      return;
    }
    daemonSpinner.succeed('Daemon started');
  }

  output.info('');
  output.success('Cloud setup complete (token)!');
  output.info(`  Agent ID: ${registration.agentId}`);
  output.info(`  Cloud:    ${cloudUrl}`);
  output.info('');
}

// ---------------------------------------------------------------------------
// Org-based setup flow (MDM device code enrollment)
// ---------------------------------------------------------------------------

async function runOrgSetup(options: { cloudUrl: string; orgClientId: string }): Promise<void> {
  output.info('');
  output.info(`  ${output.bold('Cloud Setup (Org)')}`);
  output.info('');

  const { cloudUrl, orgClientId } = options;

  // 1. Write MDM config
  const spinner = await createSpinner('Writing MDM config...');
  try {
    saveMdmConfig({
      orgClientId,
      cloudUrl,
      createdAt: new Date().toISOString(),
    });
    spinner.succeed('MDM config written (~/.agenshield/mdm.json)');
  } catch (err) {
    spinner.fail('Failed to write MDM config');
    throw new ConnectionError(`Failed to write MDM config: ${(err as Error).message}`);
  }

  // 2. Persist setup state
  writeSetupState({
    mode: 'cloud',
    cloudUrl,
    completedAt: new Date().toISOString(),
  });

  // 3. Install LaunchDaemon service (macOS, best-effort)
  if (process.platform === 'darwin') {
    const serviceSpinner = await createSpinner('Installing daemon service...');
    const daemonPath = findDaemonExecutable();

    if (daemonPath) {
      const serviceResult = installDaemonService({
        daemonPath,
        port: DAEMON_CONFIG.PORT,
        host: DAEMON_CONFIG.HOST,
      });

      if (serviceResult.success) {
        // Also install privilege helper
        const helperResult = installPrivilegeHelperService({
          daemonPath,
          userHome: os.homedir(),
        });
        if (helperResult.success) {
          serviceSpinner.succeed('Services installed (daemon + privilege helper)');
        } else {
          serviceSpinner.succeed('Daemon service installed (LaunchDaemon)');
          output.warn(`Privilege helper: ${helperResult.message}`);
        }
      } else {
        serviceSpinner.fail(serviceResult.message);
        output.info('  Run `sudo agenshield service install` to install manually.');
      }
    } else {
      serviceSpinner.fail('Daemon executable not found — skipping service install');
    }
  }

  // 4. Start daemon (best-effort)
  const daemonStatus = await getDaemonStatus();
  if (!daemonStatus.running) {
    const daemonSpinner = await createSpinner('Starting daemon...');
    const daemonResult = await startDaemon({ sudo: true });
    if (!daemonResult.success) {
      daemonSpinner.fail(daemonResult.message);
      output.warn('MDM config written, but the daemon failed to start.');
      output.info('  Run `agenshield start` to start it manually.');
      output.info('');
      output.success('Org setup complete!');
      output.info('  The daemon will initiate enrollment on next start.');
      output.info('  Open the dashboard to complete enrollment.');
      return;
    }
    daemonSpinner.succeed('Daemon started');
  }

  output.info('');
  output.success('Org setup complete!');
  output.info(`  Org:      ${orgClientId}`);
  output.info(`  Cloud:    ${cloudUrl}`);
  output.info('');
  output.info('  The daemon will initiate enrollment automatically.');
  output.info('  Open the dashboard to see the verification code.');
  output.info('');
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
    .option('--token <token>', 'Enrollment token for non-interactive cloud setup (MDM)')
    .option('--org <org>', 'Org client ID for MDM enrollment (device code flow on daemon start)')
    .action(withGlobals(async (opts) => {
      printShieldLogo();
      output.info(`  ${output.bold('Welcome to AgenShield Setup')}`);
      output.info('');

      // Org-based MDM setup (device code flow on daemon start)
      if (opts['org']) {
        const cloudUrl = (opts['cloudUrl'] as string) || CLOUD_CONFIG.url;
        await runOrgSetup({ cloudUrl, orgClientId: opts['org'] as string });
        return;
      }

      // Token-based non-interactive setup (MDM)
      if (opts['token']) {
        const cloudUrl = (opts['cloudUrl'] as string) || CLOUD_CONFIG.url;
        await runTokenSetup({ cloudUrl, token: opts['token'] as string });
        return;
      }

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
