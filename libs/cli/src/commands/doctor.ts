/**
 * Doctor command
 *
 * Diagnoses the AgenShield installation and checks for common issues.
 */

import { Command } from 'commander';
import { getEffectiveEnvForScanning } from '../utils/sudo-env.js';

/**
 * Run diagnostics
 */
async function runDoctor(): Promise<void> {
  console.log('AgenShield Doctor');
  console.log('=================');

  const { checkPrerequisites, detectOpenClaw, checkSecurityStatus } = await import(
    '@agenshield/sandbox'
  );

  // Check prerequisites
  console.log('\nPrerequisites:');
  const prereqs = checkPrerequisites();
  if (prereqs.ok) {
    console.log('  ✓ All prerequisites met');
  } else {
    console.log('  ✗ Missing prerequisites:');
    prereqs.missing.forEach((m) => console.log(`    - ${m}`));
  }

  // Check OpenClaw installation
  console.log('\nOpenClaw Installation:');
  const detection = detectOpenClaw();
  if (detection.installation.found) {
    console.log(`  ✓ Found (${detection.installation.method})`);
    console.log(`    Version: ${detection.installation.version || 'unknown'}`);
    console.log(`    Path: ${detection.installation.packagePath || 'unknown'}`);
  } else {
    console.log('  ✗ Not found');
  }

  // Security Status
  console.log('\n🔒 Security Status:');
  const security = checkSecurityStatus({ env: getEffectiveEnvForScanning() });

  // Critical issues first
  if (security.critical.length > 0) {
    console.log('\n  ⛔ CRITICAL ISSUES:');
    security.critical.forEach((c) => console.log(`    ${c}`));
  }

  // Current user
  console.log(`\n  Current user: ${security.currentUser}`);
  if (security.runningAsRoot) {
    console.log('  ⛔ Running as root - THIS IS DANGEROUS!');
  }

  // Sandbox status
  console.log('\n  Sandbox Status:');
  if (security.sandboxUserExists) {
    console.log('    ✓ User "openclaw" exists');
  } else {
    console.log('    ○ User "openclaw" not created');
  }

  if (security.isIsolated) {
    console.log('    ✓ OpenClaw is running in isolated sandbox');
  } else if (security.sandboxUserExists) {
    console.log('    ⚠ OpenClaw is NOT running in sandbox');
  }

  // Exposed secrets
  if (security.exposedSecrets.length > 0) {
    console.log('\n  ⚠ Exposed Secrets in Environment:');
    security.exposedSecrets.forEach((s) => console.log(`    - ${s}`));
    console.log('    (These would be accessible to any skill)');
  } else {
    console.log('\n  ✓ No obvious secrets in environment');
  }

  // Warnings
  if (security.warnings.length > 0) {
    console.log('\n  ⚠ Warnings:');
    security.warnings.forEach((w) => console.log(`    - ${w}`));
  }

  // Recommendations
  if (security.recommendations.length > 0) {
    console.log('\n  📋 Recommendations:');
    security.recommendations.forEach((r) => console.log(`    → ${r}`));
  }

  // Detection warnings/errors
  if (detection.warnings.length > 0) {
    console.log('\nInstallation Warnings:');
    detection.warnings.forEach((w) => console.log(`  ! ${w}`));
  }

  if (detection.errors.length > 0) {
    console.log('\nInstallation Errors:');
    detection.errors.forEach((e) => console.log(`  ✗ ${e}`));
  }

  // Summary
  console.log('\n─────────────────────');
  const hasIssues = security.critical.length > 0 || security.warnings.length > 0;
  if (security.isIsolated && !hasIssues) {
    console.log('✅ System is properly secured');
  } else if (security.critical.length > 0) {
    console.log('⛔ Critical security issues found - run "agenshield setup" immediately');
  } else if (!security.sandboxUserExists) {
    console.log('⚠ OpenClaw not isolated - run "agenshield setup" to secure');
  } else {
    console.log('⚠ Some issues found - review recommendations above');
  }
}

/**
 * Create the doctor command
 */
export function createDoctorCommand(): Command {
  const cmd = new Command('doctor')
    .description('Check and diagnose common issues')
    .option('-j, --json', 'Output as JSON')
    .option('--fix', 'Attempt to fix issues automatically')
    .action(async (options) => {
      if (options.json) {
        const { checkPrerequisites, detectOpenClaw, checkSecurityStatus } = await import(
          '@agenshield/sandbox'
        );
        const prereqs = checkPrerequisites();
        const detection = detectOpenClaw();
        const security = checkSecurityStatus({ env: getEffectiveEnvForScanning() });
        console.log(JSON.stringify({ prereqs, detection, security }, null, 2));
      } else {
        await runDoctor();
      }
    });

  return cmd;
}
