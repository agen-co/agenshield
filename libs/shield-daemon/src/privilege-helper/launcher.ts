/**
 * Privilege helper launcher
 *
 * Spawns the helper script as root using macOS `osascript` which shows
 * the native system password dialog. The helper creates a Unix socket
 * that the daemon connects to for privileged operations.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { exec } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { isSEA } from '@agenshield/ipc';

export interface PrivilegeHelperHandle {
  /** Path to the Unix socket for sending commands */
  socketPath: string;
  /** Clean up the helper process and socket */
  cleanup: () => Promise<void>;
}

interface HelperInvocation {
  binary: string;
  args: string[];
}

/**
 * Find the helper script/binary invocation.
 *
 * In multi-binary SEA mode, the daemon binary IS the helper — invoke self with `--privilege-helper`.
 * In normal mode, find the helper.js/.ts script on disk.
 */
function findHelperInvocation(): HelperInvocation {
  // Multi-binary SEA mode: invoke self with --privilege-helper flag
  if (isSEA()) {
    return {
      binary: process.execPath,
      args: ['--privilege-helper'],
    };
  }

  const __dirname = path.dirname(new URL(import.meta.url).pathname);
  const nodeBin = process.execPath;

  // Try compiled JS first (production — same directory)
  const jsPath = path.join(__dirname, 'helper.js');
  if (fs.existsSync(jsPath)) return { binary: nodeBin, args: [jsPath] };

  // Try esbuild additional entry point output (preserves directory structure)
  const nestedJsPath = path.join(__dirname, 'privilege-helper', 'helper.js');
  if (fs.existsSync(nestedJsPath)) return { binary: nodeBin, args: [nestedJsPath] };

  // Try TypeScript source (dev mode via tsx)
  const tsPath = path.join(__dirname, 'helper.ts');
  if (fs.existsSync(tsPath)) return { binary: nodeBin, args: [tsPath] };

  throw new Error(
    `Privilege helper script not found. Searched:\n  ${jsPath}\n  ${nestedJsPath}\n  ${tsPath}`,
  );
}

/**
 * Launch the privilege helper as root via osascript.
 *
 * Shows the native macOS password dialog. Returns a handle with the
 * socket path for communication and a cleanup function.
 *
 * @param options.timeout - Max time (ms) to wait for the user to enter their password (default: 30000)
 * @throws If the user cancels the dialog or the helper fails to start
 */
export async function launchPrivilegeHelper(options?: {
  timeout?: number;
}): Promise<PrivilegeHelperHandle> {
  const timeout = options?.timeout ?? 30_000;
  const socketPath = `/tmp/agenshield-priv-${crypto.randomBytes(4).toString('hex')}.sock`;
  const helper = findHelperInvocation();

  // Build the shell command that osascript will run as root
  const helperArgs = [...helper.args, socketPath].map(a => `"${a}"`).join(' ');
  const shellCmd = `"${helper.binary}" ${helperArgs} 2>/tmp/agenshield-priv-helper.log &`;

  let helperProc: ChildProcess | null = null;

  return new Promise<PrivilegeHelperHandle>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error('Timed out waiting for privilege helper (user may have cancelled the dialog)'));
    }, timeout);

    // Use osascript to show macOS native password dialog and run as root
    const escaped = shellCmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const osaCmd = `osascript -e 'do shell script "${escaped}" with administrator privileges'`;

    helperProc = exec(osaCmd, (err) => {
      if (err) {
        clearTimeout(timeoutId);
        // User cancelled or authentication failed
        const msg = err.message.includes('User canceled')
          ? 'Administrator access was cancelled'
          : `Failed to launch privilege helper: ${err.message}`;
        reject(new Error(msg));
      }
    });

    // Poll for the socket to appear (helper creates it on startup)
    const pollInterval = setInterval(() => {
      if (fs.existsSync(socketPath)) {
        clearInterval(pollInterval);
        clearTimeout(timeoutId);

        resolve({
          socketPath,
          cleanup: async () => {
            // Send shutdown command to the helper
            try {
              const net = await import('node:net');
              const client = net.connect(socketPath);
              client.write(JSON.stringify({ id: 0, method: 'shutdown' }) + '\n');
              client.end();
            } catch { /* helper may already be gone */ }

            // Clean up socket file
            try {
              if (fs.existsSync(socketPath)) {
                fs.unlinkSync(socketPath);
              }
            } catch { /* ignore */ }
          },
        });
      }
    }, 200);
  });
}
