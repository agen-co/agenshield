/**
 * Status command
 *
 * Shows the current AgenShield installation and security status.
 */

import { Command } from 'commander';

/**
 * Show the current status
 */
async function showStatus(): Promise<void> {
  console.log('AgenShield Status');
  console.log('=================\n');

  const { detectOpenClaw, checkSecurityStatus } = await import('@agenshield/sandbox');

  const detection = detectOpenClaw();
  const security = checkSecurityStatus();

  // Quick status indicators
  const indicators = {
    openclaw: detection.installation.found ? '✓' : '✗',
    sandbox: security.sandboxUserExists ? '✓' : '○',
    isolated: security.isIsolated ? '✓' : '○',
    secrets: security.exposedSecrets.length === 0 ? '✓' : '⚠',
  };

  console.log(
    `OpenClaw:     ${indicators.openclaw} ${detection.installation.found ? `v${detection.installation.version || 'unknown'} (${detection.installation.method})` : 'Not installed'}`
  );
  console.log(
    `Sandbox User: ${indicators.sandbox} ${security.sandboxUserExists ? 'Created' : 'Not created'}`
  );
  console.log(
    `Isolation:    ${indicators.isolated} ${security.isIsolated ? 'Active' : 'Not active'}`
  );
  console.log(
    `Secrets:      ${indicators.secrets} ${security.exposedSecrets.length === 0 ? 'Protected' : `${security.exposedSecrets.length} exposed`}`
  );

  // Overall status
  console.log('\n─────────────────────');
  if (security.critical.length > 0) {
    console.log('Status: ⛔ CRITICAL - Immediate action required');
  } else if (security.isIsolated) {
    console.log('Status: ✅ SECURE');
  } else if (security.sandboxUserExists) {
    console.log('Status: ⚠ PARTIAL - OpenClaw not running in sandbox');
  } else {
    console.log('Status: ⚠ UNPROTECTED - Run "agenshield setup"');
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
        const { detectOpenClaw, checkSecurityStatus } = await import('@agenshield/sandbox');
        const detection = detectOpenClaw();
        const security = checkSecurityStatus();
        console.log(JSON.stringify({ detection, security }, null, 2));
      } else {
        await showStatus();
      }
    });

  return cmd;
}
