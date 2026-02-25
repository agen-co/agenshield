/**
 * Exec command
 *
 * Opens an interactive guarded shell as the sandboxed agent user for any
 * installed AgenShield target.
 *
 * @example
 * ```bash
 * agenshield exec openclaw      # -> ash_openclaw_agent
 * agenshield exec claudecode    # -> ash_claudecode_agent
 * ```
 */

import { Command } from 'commander';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ensureSudoAccess } from '../utils/privileges.js';
import { output } from '../utils/output.js';
import { ensureSetupComplete } from '../utils/setup-guard.js';
import { TargetNotFoundError, CliError } from '../errors.js';
import {
  listAgenshieldUsers,
  userExists,
  guardedShellPath,
} from '@agenshield/sandbox';

/**
 * Resolve the agent username for a given target name.
 */
function resolveAgentUsername(target: string): string | null {
  const users = listAgenshieldUsers();

  const exactMatch = users.find(
    (u) => u.username === `ash_${target}_agent`
  );
  if (exactMatch) return exactMatch.username;

  const fuzzyMatch = users.find(
    (u) =>
      u.username.includes(`_${target}`) && u.username.endsWith('_agent')
  );
  if (fuzzyMatch) return fuzzyMatch.username;

  return `ash_${target}_agent`;
}

/**
 * Create the `exec` command
 */
export function createExecCommand(): Command {
  return new Command('exec')
    .description('Open an interactive guarded shell as a sandboxed agent user (e.g. exec openclaw)')
    .argument('<target>', 'Installed target name \u2014 maps to ash_{target}_agent user')
    .action(async (target: string) => {
      ensureSetupComplete();
      ensureSudoAccess();

      const agentUsername = resolveAgentUsername(target);
      if (!agentUsername) {
        throw new TargetNotFoundError(target, `Could not resolve agent user for target "${target}".`);
      }

      const exists = await userExists(agentUsername);
      if (!exists) {
        const users = listAgenshieldUsers();
        const agents = users.filter((u) => u.username.endsWith('_agent'));
        let msg = `Agent user "${agentUsername}" does not exist.\n\nAvailable agent users:`;
        if (agents.length === 0) {
          msg += '\n  (none found)';
        } else {
          for (const u of agents) {
            msg += `\n  - ${u.username}`;
          }
        }
        throw new TargetNotFoundError(target, msg);
      }

      const agentHome = `/Users/${agentUsername}`;
      const shellPath = guardedShellPath(agentHome);
      if (!fs.existsSync(shellPath)) {
        throw new CliError(
          `Guarded shell not found at: ${shellPath}\nThe target may not be fully shielded. Run the setup wizard first.`,
          'SHELL_NOT_FOUND',
        );
      }

      const binDir = path.join(agentHome, 'bin');
      let binContents: string[] = [];
      try {
        binContents = fs.readdirSync(binDir);
      } catch {
        // bin dir may not exist
      }

      output.info('');
      output.info('Opening sandboxed shell');
      output.info(`  Target: ${target}`);
      output.info(`  User:   ${agentUsername}`);
      output.info(`  Home:   ${agentHome}`);
      output.info(`  Shell:  ${shellPath}`);
      output.info('  PATH:   $HOME/bin:$HOME/homebrew/bin');
      output.info('');
      if (binContents.length > 0) {
        output.info(`  Available commands (${binContents.length}):`);
        for (const cmd of binContents) {
          output.info(`    - ${cmd}`);
        }
      } else {
        output.info('  No commands found in $HOME/bin');
      }
      output.info('');
      output.info('Type exit to leave the sandboxed shell.');
      output.info('---');

      const result = spawnSync('sudo', ['-u', agentUsername, shellPath], {
        stdio: 'inherit',
      });

      output.info('');
      output.info('Shell session ended.');

      if (result.status !== 0 && result.status !== null) {
        process.exitCode = result.status;
      }
    });
}
