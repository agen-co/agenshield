/**
 * Setup command
 *
 * Runs the interactive setup wizard to sandbox a target application.
 * Supports presets (openclaw, custom) and configurable naming.
 */

import { Command } from 'commander';
import React from 'react';
import { render } from 'ink';
import { WizardApp } from '../wizard/index.js';
import { ensureRoot } from '../utils/privileges.js';
import { formatPresetList, getPreset } from '@agenshield/sandbox';

/**
 * Run the setup wizard
 */
async function runSetup(): Promise<void> {
  const { waitUntilExit } = render(React.createElement(WizardApp));
  await waitUntilExit();
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
