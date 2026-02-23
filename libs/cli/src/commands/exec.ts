/**
 * Exec command
 *
 * Opens an interactive guarded shell as the sandboxed agent user for any
 * installed AgenShield target. The target name maps to the macOS user
 * ash_{target}_agent (e.g. "openclaw" → ash_openclaw_agent,
 * "claudecode" → ash_claudecode_agent).
 *
 * @example
 * ```bash
 * agenshield exec openclaw      # → ash_openclaw_agent
 * agenshield exec claudecode    # → ash_claudecode_agent
 * agenshield exec default       # → ash_default_agent
 * ```
 */

import { Command } from 'commander';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ensureSudoAccess } from '../utils/privileges.js';
import {
  listAgenshieldUsers,
  userExists,
  guardedShellPath,
} from '@agenshield/sandbox';

/**
 * Resolve the agent username for a given target name.
 *
 * Scans /Users/ash_* directories and matches by:
 * 1. Username contains `_{target}_agent` (e.g. ash_openclaw_agent)
 * 2. Falls back to constructing `ash_{target}_agent` directly
 */
function resolveAgentUsername(target: string): string | null {
  const users = listAgenshieldUsers();

  // Exact match: ash_{target}_agent
  const exactMatch = users.find(
    (u) => u.username === `ash_${target}_agent`
  );
  if (exactMatch) return exactMatch.username;

  // Fuzzy match: username contains the target and ends with _agent
  const fuzzyMatch = users.find(
    (u) =>
      u.username.includes(`_${target}`) && u.username.endsWith('_agent')
  );
  if (fuzzyMatch) return fuzzyMatch.username;

  // Fallback: construct the expected username
  return `ash_${target}_agent`;
}

/**
 * Create the `exec` command
 */
export function createExecCommand(): Command {
  return new Command('exec')
    .description('Open an interactive guarded shell as a sandboxed agent user (e.g. exec openclaw → ash_openclaw_agent)')
    .argument('<target>', 'Installed target name — maps to ash_{target}_agent user')
    .action(async (target: string) => {
      // 1. Ensure sudo access
      ensureSudoAccess();

      // 2. Resolve agent username from target
      const agentUsername = resolveAgentUsername(target);
      if (!agentUsername) {
        console.error(`Could not resolve agent user for target "${target}".`);
        process.exit(1);
      }

      // 3. Verify user exists
      const exists = await userExists(agentUsername);
      if (!exists) {
        console.error(`Agent user "${agentUsername}" does not exist.`);
        console.error('');
        console.error('Available agent users:');
        const users = listAgenshieldUsers();
        const agents = users.filter((u) => u.username.endsWith('_agent'));
        if (agents.length === 0) {
          console.error('  (none found)');
        } else {
          for (const u of agents) {
            console.error(`  - ${u.username}`);
          }
        }
        process.exit(1);
      }

      // 4. Resolve agent home
      const agentHome = `/Users/${agentUsername}`;

      // 5. Verify guarded shell exists
      const shellPath = guardedShellPath(agentHome);
      if (!fs.existsSync(shellPath)) {
        console.error(`Guarded shell not found at: ${shellPath}`);
        console.error('The target may not be fully shielded. Run the setup wizard first.');
        process.exit(1);
      }

      // 6. List available commands in ~/bin
      const binDir = path.join(agentHome, 'bin');
      let binContents: string[] = [];
      try {
        binContents = fs.readdirSync(binDir);
      } catch {
        // bin dir may not exist
      }

      // 7. Print info
      console.log('');
      console.log('Opening sandboxed shell');
      console.log(`  Target: ${target}`);
      console.log(`  User:   ${agentUsername}`);
      console.log(`  Home:   ${agentHome}`);
      console.log(`  Shell:  ${shellPath}`);
      console.log(`  PATH:   $HOME/bin:$HOME/homebrew/bin`);
      console.log('');
      if (binContents.length > 0) {
        console.log(`  Available commands (${binContents.length}):`);
        for (const cmd of binContents) {
          console.log(`    - ${cmd}`);
        }
      } else {
        console.log('  No commands found in $HOME/bin');
      }
      console.log('');
      console.log('Type exit to leave the sandboxed shell.');
      console.log('---');

      // 8. Spawn guarded shell as agent user
      const result = spawnSync('sudo', ['-u', agentUsername, shellPath], {
        stdio: 'inherit',
      });

      // 9. Shell exited
      console.log('');
      console.log('Shell session ended.');

      if (result.status !== 0 && result.status !== null) {
        process.exit(result.status);
      }
    });
}
