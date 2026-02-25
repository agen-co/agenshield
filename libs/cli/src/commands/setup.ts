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

import { Command } from 'commander';
import * as os from 'node:os';
import * as readline from 'node:readline';
import {
  getDaemonStatus,
  startDaemon,
  readAdminToken,
  fetchAdminToken,
} from '../utils/daemon.js';
import { openBrowser, buildBrowserUrl, waitForAdminToken } from '../utils/browser.js';
import { ensureSudoAccess, startSudoKeepalive } from '../utils/privileges.js';
import { output } from '../utils/output.js';
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

// ---------------------------------------------------------------------------
// Lightweight readline prompts
// ---------------------------------------------------------------------------

function createRl(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });
}

/**
 * Present a numbered list and wait for the user to pick one.
 */
async function promptSelect(
  question: string,
  options: { label: string; value: string }[],
): Promise<string> {
  const rl = createRl();
  try {
    output.info(question);
    for (let i = 0; i < options.length; i++) {
      output.info(`    [${i + 1}] ${options[i].label}`);
    }
    output.info('');

    return await new Promise<string>((resolve) => {
      const ask = () => {
        rl.question('  Enter choice: ', (answer) => {
          const idx = parseInt(answer.trim(), 10) - 1;
          if (idx >= 0 && idx < options.length) {
            resolve(options[idx].value);
          } else {
            output.warn(`  Please enter a number between 1 and ${options.length}`);
            ask();
          }
        });
      };
      ask();
    });
  } finally {
    rl.close();
  }
}

/**
 * Ask for text input with an optional default value.
 */
async function promptInput(question: string, defaultValue?: string): Promise<string> {
  const rl = createRl();
  try {
    const suffix = defaultValue ? ` (${defaultValue})` : '';
    return await new Promise<string>((resolve) => {
      rl.question(`  ${question}${suffix}: `, (answer) => {
        const value = answer.trim();
        resolve(value || defaultValue || '');
      });
    });
  } finally {
    rl.close();
  }
}

// ---------------------------------------------------------------------------
// Local setup flow
// ---------------------------------------------------------------------------

async function runLocalSetup(options: { browser: boolean }): Promise<void> {
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
    if (token) {
      output.info('  Admin token:');
      output.info(`  ${output.dim(token)}`);
      output.info('');
    }
    output.info('  Dashboard:');
    output.info(`  ${output.cyan(url)}`);
    output.info('');

    // Persist setup state
    writeSetupState({ mode: 'local', completedAt: new Date().toISOString() });

    if (options.browser) {
      openBrowser(url);
    }

    output.success('Setup complete!');
    return;
  }

  // 3. Start daemon
  output.info('  Starting daemon...');
  const result = await startDaemon({ sudo: true });

  if (!result.success) {
    throw new DaemonStartError(result.message);
  }

  // 4. Wait for admin token
  const token = await waitForAdminToken();
  const url = buildBrowserUrl(token);

  output.success(`Daemon started${result.pid ? ` (PID: ${result.pid})` : ''}`);
  output.info('');
  if (token) {
    output.info('  Admin token:');
    output.info(`  ${output.dim(token)}`);
    output.info('');
  }
  output.info('  Dashboard:');
  output.info(`  ${output.cyan(url)}`);
  output.info('');

  // 5. Persist setup state
  writeSetupState({ mode: 'local', completedAt: new Date().toISOString() });

  // 6. Open browser
  if (options.browser) {
    openBrowser(url);
  }

  output.success('Setup complete!');
}

// ---------------------------------------------------------------------------
// Cloud setup flow
// ---------------------------------------------------------------------------

async function runCloudSetup(options: { browser: boolean; cloudUrl: string }): Promise<void> {
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

    // 3. Display verification instructions
    output.info('');
    output.info('  To authorize this device, open the following URL:');
    output.info('');
    output.info(`    ${output.cyan(deviceCode.verificationUri)}`);
    output.info('');
    output.info('  And enter this code:');
    output.info('');
    output.info(`    ${output.bold(output.yellow(deviceCode.userCode))}`);
    output.info('');

    // 4. Open browser automatically
    if (options.browser) {
      openBrowser(deviceCode.verificationUri);
    }

    // 5. Poll for authorization
    output.info('  Waiting for authorization...');
    const pollResult = await pollDeviceCode(
      cloudUrl,
      deviceCode.deviceCode,
      deviceCode.interval,
    );

    if (pollResult.status !== 'approved') {
      throw new AuthError(`Authorization ${pollResult.status}: ${pollResult.error || 'Device code was not approved'}`);
    }

    output.success(`Authorized by ${pollResult.companyName || 'your organization'}`);
    output.info('');

    // 6. Generate Ed25519 keypair
    output.info('  Generating device keypair...');
    const keypair = generateEd25519Keypair();

    // 7. Register device with cloud
    output.info('  Registering device...');
    const registration = await registerDevice(
      cloudUrl,
      pollResult.enrollmentToken!,
      keypair.publicKey,
      os.hostname(),
    );

    // 8. Save credentials locally
    saveCloudCredentials(
      registration.agentId,
      keypair.privateKey,
      cloudUrl,
      pollResult.companyName || 'Unknown',
    );

    output.success(`Device registered (ID: ${registration.agentId})`);
    output.info('');

    // 9. Start daemon
    const daemonStatus = await getDaemonStatus();
    if (!daemonStatus.running) {
      output.info('  Starting daemon...');
      const daemonResult = await startDaemon({ sudo: true });
      if (!daemonResult.success) {
        output.error(daemonResult.message);
        output.info('  Cloud enrollment succeeded, but the daemon failed to start.');
        output.info('  Run `agenshield start` to start it manually.');
        throw new DaemonStartError(daemonResult.message);
      }
      output.success('Daemon started');
    }

    // 10. Open dashboard
    const adminToken = await waitForAdminToken();
    const url = buildBrowserUrl(adminToken);

    // 11. Persist setup state
    writeSetupState({
      mode: 'cloud',
      cloudUrl,
      completedAt: new Date().toISOString(),
    });

    output.info('');
    output.success('Cloud setup complete!');
    output.info(`  Company: ${pollResult.companyName || 'Unknown'}`);
    output.info(`  Dashboard: ${output.cyan(url)}`);
    output.info('');

    if (options.browser) {
      openBrowser(url);
    }
  } finally {
    clearInterval(sudoKeepalive);
  }
}

// ---------------------------------------------------------------------------
// Command definition
// ---------------------------------------------------------------------------

/**
 * Create the setup command
 */
export function createSetupCommand(): Command {
  const cmd = new Command('setup')
    .description('Set up AgenShield (interactive guided flow)')
    .option('--mode <mode>', 'Skip mode prompt: "local" or "cloud"')
    .option('--cloud-url <url>', 'Cloud API URL (skips prompt, implies --mode cloud)')
    .option('--no-browser', 'Do not open the browser automatically')
    .action(async (options) => {
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

      if (options.cloudUrl) {
        mode = 'cloud';
      } else if (options.mode) {
        mode = options.mode;
      } else {
        mode = await promptSelect('  Choose setup mode:', [
          { label: 'Local  — Run AgenShield locally on this machine', value: 'local' },
          { label: 'Cloud  — Connect to AgenShield Cloud for centralized management', value: 'cloud' },
        ]);
      }

      if (mode === 'local') {
        await runLocalSetup({ browser: options.browser !== false });
      } else if (mode === 'cloud') {
        // Determine cloud URL: from flag or interactively
        let cloudUrl: string;
        if (options.cloudUrl) {
          cloudUrl = options.cloudUrl;
        } else {
          cloudUrl = await promptInput('Cloud URL', CLOUD_CONFIG.url);
        }

        await runCloudSetup({ browser: options.browser !== false, cloudUrl });
      } else {
        output.error(`Unknown mode: "${mode}". Use "local" or "cloud".`);
        process.exitCode = 2;
      }
    });

  return cmd;
}
