/**
 * Setup command
 *
 * Runs the interactive setup wizard to sandbox a target application.
 * Supports presets (openclaw, custom) and configurable naming.
 * With --ui flag, launches a web-based setup wizard.
 */

import { Command } from 'commander';
import React from 'react';
import { render } from 'ink';
import { WizardApp } from '../wizard/index.js';
import { ensureRoot } from '../utils/privileges.js';
import { formatPresetList, getPreset } from '@agenshield/sandbox';
import { createWizardEngine } from '../wizard/engine.js';
import type { WizardOptions } from '../wizard/types.js';

/**
 * Run the setup wizard (CLI/Ink mode)
 */
async function runSetup(): Promise<void> {
  const { waitUntilExit } = render(React.createElement(WizardApp));
  await waitUntilExit();
}

/**
 * Run the setup wizard in web UI mode
 */
async function runSetupWebUI(wizardOptions: WizardOptions): Promise<void> {
  const { createSetupServer } = await import('../setup-server/index.js');

  console.log('');
  console.log('  Starting Web UI Setup Wizard...');
  console.log('');

  // Create wizard engine and run detection phase BEFORE server starts
  const engine = createWizardEngine(wizardOptions);
  const detectionResult = await engine.runDetectionPhase();

  if (!detectionResult.success) {
    console.error(`  Detection failed: ${detectionResult.error}`);
    process.exit(1);
  }

  if (!engine.context.presetDetection?.found) {
    console.error('  No supported target found. Use --target custom --entry-point <path> for custom applications.');
    process.exit(1);
  }

  console.log(`  Detected: ${engine.context.preset?.name ?? 'Unknown target'}`);
  console.log('');

  // Create and start the setup server
  const server = createSetupServer(engine);
  const port = 6969;
  const url = await server.start(port);

  console.log(`  Setup wizard is running at: ${url}`);
  console.log('');
  console.log('  Opening browser...');
  console.log('  (If the browser does not open, visit the URL above manually)');
  console.log('');

  // Open browser (macOS)
  try {
    const { exec } = await import('node:child_process');
    exec(`open "${url}"`);
  } catch {
    // Non-fatal — user can open the URL manually
  }

  // Wait for setup to complete or be cancelled
  try {
    await server.waitForCompletion();
    console.log('  Setup complete! Shutting down server...');
  } finally {
    await server.stop();
  }
}

/**
 * Build WizardOptions from CLI options
 */
function buildWizardOptions(options: Record<string, unknown>): WizardOptions {
  const wizardOptions: WizardOptions = {};
  if (options['target']) wizardOptions.targetPreset = options['target'] as string;
  if (options['entryPoint']) wizardOptions.entryPoint = options['entryPoint'] as string;
  if (options['baseName']) wizardOptions.baseName = options['baseName'] as string;
  if (options['prefix']) wizardOptions.prefix = options['prefix'] as string;
  if (options['baseUid']) wizardOptions.baseUid = options['baseUid'] as number;
  if (options['dryRun']) wizardOptions.dryRun = true;
  if (options['skipConfirm']) wizardOptions.skipConfirm = true;
  if (options['verbose']) wizardOptions.verbose = true;
  return wizardOptions;
}

/**
 * Create the setup command
 */
export function createSetupCommand(): Command {
  const cmd = new Command('setup')
    .description('Run the setup wizard to sandbox a target application')
    .option('--target <preset>', 'Target preset to use: openclaw, custom (default: auto-detect)')
    .option('--entry-point <path>', 'Entry point for custom target (Node.js file)')
    .option('--base-name <name>', 'Base name for users/groups (default: agenshield)')
    .option('--prefix <prefix>', 'Use a custom prefix for users/groups (for testing)')
    .option('--base-uid <uid>', 'Base UID for created users', parseInt)
    .option('--dry-run', 'Show what would be done without making changes')
    .option('--skip-confirm', 'Skip confirmation prompts')
    .option('-v, --verbose', 'Show verbose output')
    .option('--list-presets', 'List available presets and exit')
    .option('--ui', 'Use web browser UI for setup wizard')
    .action(async (options) => {
      // Handle --list-presets
      if (options.listPresets) {
        console.log(formatPresetList());
        return;
      }

      // Validate --target option
      if (options.target) {
        const preset = getPreset(options.target);
        if (!preset) {
          console.error(`Error: Unknown preset '${options.target}'`);
          console.error('');
          console.error(formatPresetList());
          process.exit(1);
        }

        // Custom preset requires --entry-point
        if (options.target === 'custom' && !options.entryPoint) {
          console.error('Error: --entry-point is required when using --target custom');
          console.error('');
          console.error('Example:');
          console.error('  agenshield setup --target custom --entry-point /path/to/my-app/dist/index.js');
          process.exit(1);
        }
      }

      // Require root unless dry-run
      if (!options.dryRun) {
        ensureRoot('setup');
      }

      // Check for Web UI request (either --ui flag or env var from Ink wizard)
      if (options.ui || process.env['AGENSHIELD_WEBUI_REQUESTED'] === 'true') {
        delete process.env['AGENSHIELD_WEBUI_REQUESTED'];
        await runSetupWebUI(buildWizardOptions(options));
        return;
      }

      // Store options in environment for wizard to pick up
      if (options.target) {
        process.env['AGENSHIELD_TARGET'] = options.target;
      }
      if (options.entryPoint) {
        process.env['AGENSHIELD_ENTRY_POINT'] = options.entryPoint;
      }
      if (options.baseName) {
        process.env['AGENSHIELD_BASE_NAME'] = options.baseName;
      }
      if (options.prefix) {
        process.env['AGENSHIELD_PREFIX'] = options.prefix;
      }
      if (options.baseUid) {
        process.env['AGENSHIELD_BASE_UID'] = String(options.baseUid);
      }
      if (options.dryRun) {
        process.env['AGENSHIELD_DRY_RUN'] = 'true';
      }
      if (options.skipConfirm) {
        process.env['AGENSHIELD_SKIP_CONFIRM'] = 'true';
      }
      if (options.verbose) {
        process.env['AGENSHIELD_VERBOSE'] = 'true';
      }

      await runSetup();
    });

  return cmd;
}
