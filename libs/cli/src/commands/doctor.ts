/**
 * Doctor command
 *
 * Diagnoses the AgenShield installation and checks for common issues.
 */

import { Option } from 'clipanion';
import { BaseCommand } from './base.js';
import { getEffectiveEnvForScanning } from '../utils/sudo-env.js';
import { output } from '../utils/output.js';
import { createSpinner } from '../utils/spinner.js';

/**
 * Run diagnostics
 */
async function runDoctor(): Promise<void> {
  output.info('AgenShield Doctor');
  output.info('=================');

  const spinner = await createSpinner('Running diagnostics...');

  const { checkPrerequisites, detectOpenClaw, checkSecurityStatus } = await import(
    '@agenshield/sandbox'
  );

  spinner.stop();

  // Check prerequisites
  output.info('\nPrerequisites:');
  const prereqs = checkPrerequisites();
  if (prereqs.ok) {
    output.info('  \u2713 All prerequisites met');
  } else {
    output.info('  \u2717 Missing prerequisites:');
    prereqs.missing.forEach((m: string) => output.info(`    - ${m}`));
  }

  // Check OpenClaw installation
  output.info('\nOpenClaw Installation:');
  const detection = detectOpenClaw();
  if (detection.installation.found) {
    output.info(`  \u2713 Found (${detection.installation.method})`);
    output.info(`    Version: ${detection.installation.version || 'unknown'}`);
    output.info(`    Path: ${detection.installation.packagePath || 'unknown'}`);
  } else {
    output.info('  \u2717 Not found');
  }

  // Security Status
  output.info('\nSecurity Status:');
  const security = await checkSecurityStatus({ env: getEffectiveEnvForScanning() });

  if (security.critical.length > 0) {
    output.info('\n  CRITICAL ISSUES:');
    security.critical.forEach((c: string) => output.info(`    ${c}`));
  }

  output.info(`\n  Current user: ${security.currentUser}`);
  if (security.runningAsRoot) {
    output.info('  Running as root - THIS IS DANGEROUS!');
  }

  output.info('\n  Sandbox Status:');
  if (security.sandboxUserExists) {
    output.info('    \u2713 User "openclaw" exists');
  } else {
    output.info('    \u25CB User "openclaw" not created');
  }

  if (security.isIsolated) {
    output.info('    \u2713 OpenClaw is running in isolated sandbox');
  } else if (security.sandboxUserExists) {
    output.info('    \u26A0 OpenClaw is NOT running in sandbox');
  }

  if (security.exposedSecrets.length > 0) {
    output.info('\n  \u26A0 Exposed Secrets in Environment:');
    security.exposedSecrets.forEach((s: string) => output.info(`    - ${s}`));
    output.info('    (These would be accessible to any skill)');
  } else {
    output.info('\n  \u2713 No obvious secrets in environment');
  }

  if (security.warnings.length > 0) {
    output.info('\n  \u26A0 Warnings:');
    security.warnings.forEach((w: string) => output.info(`    - ${w}`));
  }

  if (security.recommendations.length > 0) {
    output.info('\n  Recommendations:');
    security.recommendations.forEach((r: string) => output.info(`    \u2192 ${r}`));
  }

  if (detection.warnings.length > 0) {
    output.info('\nInstallation Warnings:');
    detection.warnings.forEach((w: string) => output.info(`  ! ${w}`));
  }

  if (detection.errors.length > 0) {
    output.info('\nInstallation Errors:');
    detection.errors.forEach((e: string) => output.info(`  \u2717 ${e}`));
  }

  output.info('\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
  const hasIssues = security.critical.length > 0 || security.warnings.length > 0;
  if (security.isIsolated && !hasIssues) {
    output.info('\u2705 System is properly secured');
  } else if (security.critical.length > 0) {
    output.info('\u26D4 Critical security issues found - run "agenshield setup" immediately');
  } else if (!security.sandboxUserExists) {
    output.info('\u26A0 OpenClaw not isolated - run "agenshield setup" to secure');
  } else {
    output.info('\u26A0 Some issues found - review recommendations above');
  }
}

export class DoctorCommand extends BaseCommand {
  static override paths = [['doctor']];

  static override usage = BaseCommand.Usage({
    category: 'Setup & Maintenance',
    description: 'Check and diagnose common issues',
    examples: [
      ['Run diagnostics', '$0 doctor'],
      ['Output diagnostics as JSON', '$0 doctor --json'],
    ],
  });

  fix = Option.Boolean('--fix', false, { description: 'Attempt to fix issues automatically' });

  async run(): Promise<number | void> {
    if (this.json) {
      const { checkPrerequisites, detectOpenClaw, checkSecurityStatus } = await import(
        '@agenshield/sandbox'
      );
      const prereqs = checkPrerequisites();
      const detection = detectOpenClaw();
      const security = await checkSecurityStatus({ env: getEffectiveEnvForScanning() });
      output.data({ prereqs, detection, security });
    } else {
      await runDoctor();
    }
  }
}
