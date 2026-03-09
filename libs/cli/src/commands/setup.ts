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
import type {
  SetupStatusResponse,
  SetupCloudResponse,
  SetupLocalResponse,
  ApiResponse,
} from '@agenshield/ipc';
import { saveMdmConfig } from '@agenshield/auth';
// eslint-disable-next-line @nx/enforce-module-boundaries
import { installDaemonService, installPrivilegeHelperService } from '@agenshield/seatbelt';
import { inkSelect, inkInput, inkBrowserLink } from '../prompts/index.js';
import { resolveHostHome } from '../utils/host-user.js';

// ---------------------------------------------------------------------------
// Daemon helpers
// ---------------------------------------------------------------------------

const DAEMON_API_BASE = `http://${DAEMON_CONFIG.HOST}:${DAEMON_CONFIG.PORT}`;

/**
 * Ensure the daemon is running, starting it with sudo if needed.
 */
async function ensureDaemonRunning(): Promise<void> {
  const status = await getDaemonStatus();
  if (status.running) return;

  ensureSudoAccess();

  const spinner = await createSpinner('Starting daemon...');
  const result = await startDaemon({ sudo: true });

  if (!result.success) {
    spinner.fail('Failed to start daemon');
    throw new DaemonStartError(result.message);
  }
  spinner.succeed(`Daemon started${result.pid ? ` (PID: ${result.pid})` : ''}`);
}

/**
 * Call a daemon API endpoint and parse the JSON response.
 */
async function daemonFetch<T>(path: string, opts?: RequestInit): Promise<ApiResponse<T>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(`${DAEMON_API_BASE}${path}`, {
      ...opts,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return (await res.json()) as ApiResponse<T>;
  } catch (err) {
    clearTimeout(timeout);
    throw new ConnectionError(`Failed to reach daemon: ${(err as Error).message}`);
  }
}

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

  // 1. Ensure daemon is running
  await ensureDaemonRunning();

  // 2. Call daemon setup endpoint
  const spinner = await createSpinner('Configuring local mode...');
  const res = await daemonFetch<SetupLocalResponse>('/api/setup/local', { method: 'POST' });

  if (!res.success || !res.data) {
    spinner.fail('Local setup failed');
    throw new ConnectionError((res as { error?: { message?: string } }).error?.message ?? 'Unknown error');
  }

  const token = res.data.adminToken;
  const url = buildBrowserUrl(token);

  spinner.succeed('Local mode configured');
  output.info('');

  // 3. Also persist setup state on CLI side (for setup-guard)
  writeSetupState({ mode: 'local', completedAt: new Date().toISOString() });

  await inkBrowserLink({ url, label: 'Dashboard', token });
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

  // 1. Ensure daemon is running
  await ensureDaemonRunning();
  const sudoKeepalive = startSudoKeepalive();

  try {
    // 2. Kick off cloud enrollment via daemon
    output.info('  Contacting AgenShield Cloud...');
    const cloudRes = await daemonFetch<SetupCloudResponse>('/api/setup/cloud', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cloudUrl }),
    });

    if (!cloudRes.success || !cloudRes.data) {
      throw new ConnectionError((cloudRes as { error?: { message?: string } }).error?.message ?? 'Failed to start cloud enrollment');
    }

    const enrollment = cloudRes.data.enrollment;

    if (enrollment.state === 'failed') {
      throw new AuthError(enrollment.error ?? 'Enrollment failed');
    }

    // 3. Display verification URL + code
    if (enrollment.verificationUri) {
      output.info('');
      await inkBrowserLink({ url: enrollment.verificationUri, label: 'Authorize this device' });
      if (enrollment.userCode) {
        output.info(`  ${output.dim(`Code: ${enrollment.userCode}`)}`);
      }
      output.info('');
    }

    // 4. Poll setup/status until enrollment completes or fails
    const spinner = await createSpinner('Waiting for authorization...');
    const pollDeadline = Date.now() + 15 * 60 * 1000; // 15 min max

    let companyName = 'Unknown';
    while (Date.now() < pollDeadline) {
      await new Promise((r) => setTimeout(r, 3_000));

      const statusRes = await daemonFetch<SetupStatusResponse>('/api/setup/status');
      if (!statusRes.success || !statusRes.data) continue;

      const es = statusRes.data.enrollment;

      if (es.state === 'complete') {
        companyName = es.companyName ?? 'Unknown';
        spinner.succeed(`Authorized by ${companyName}`);
        break;
      }

      if (es.state === 'failed') {
        spinner.fail('Authorization failed');
        throw new AuthError(es.error ?? 'Enrollment failed');
      }

      // Still pending — keep polling
    }

    // 5. Persist setup state on CLI side
    writeSetupState({
      mode: 'cloud',
      cloudUrl,
      completedAt: new Date().toISOString(),
    });

    // 6. Get admin token and show dashboard link
    const adminToken = await waitForAdminToken();
    const url = buildBrowserUrl(adminToken);

    output.info('');
    output.success('Cloud setup complete!');
    output.info(`  Company: ${companyName}`);
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

  // Ensure downstream libs (@agenshield/auth) resolve paths correctly under sudo/root
  if (process.getuid?.() === 0 && !process.env['AGENSHIELD_USER_HOME']) {
    process.env['AGENSHIELD_USER_HOME'] = resolveHostHome();
  }

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
  const hostHome = resolveHostHome();
  if (process.platform === 'darwin') {
    const serviceSpinner = await createSpinner('Installing daemon service...');
    const daemonPath = findDaemonExecutable();

    if (daemonPath) {
      const serviceResult = await installDaemonService({
        daemonPath,
        port: DAEMON_CONFIG.PORT,
        host: DAEMON_CONFIG.HOST,
        userHome: hostHome,
      });

      if (serviceResult.success) {
        // Also install privilege helper
        const helperResult = await installPrivilegeHelperService({
          daemonPath,
          userHome: hostHome,
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

  // Ensure downstream libs (@agenshield/auth) resolve paths correctly under sudo/root
  if (process.getuid?.() === 0 && !process.env['AGENSHIELD_USER_HOME']) {
    process.env['AGENSHIELD_USER_HOME'] = resolveHostHome();
  }

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
  const orgHostHome = resolveHostHome();
  if (process.platform === 'darwin') {
    const serviceSpinner = await createSpinner('Installing daemon service...');
    const daemonPath = findDaemonExecutable();

    if (daemonPath) {
      const serviceResult = await installDaemonService({
        daemonPath,
        port: DAEMON_CONFIG.PORT,
        host: DAEMON_CONFIG.HOST,
        userHome: orgHostHome,
      });

      if (serviceResult.success) {
        // Also install privilege helper
        const helperResult = await installPrivilegeHelperService({
          daemonPath,
          userHome: orgHostHome,
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
