/**
 * Dev Test Harness Preset
 *
 * Preset for detecting and migrating the AgenShield test harness (dummy-openclaw).
 * Auto-detected in dev mode so the setup wizard works without workarounds.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import type {
  TargetPreset,
  PresetDetectionResult,
  MigrationContext,
  PresetMigrationResult,
} from './types.js';

/**
 * Execute a command with sudo
 */
function sudoExec(cmd: string): { success: boolean; output?: string; error?: string } {
  try {
    const output = execSync(`sudo ${cmd}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { success: true, output: output.trim() };
  } catch (err: unknown) {
    const error = err as { stderr?: string; message?: string };
    return { success: false, error: error.stderr || error.message || 'Unknown error' };
  }
}

/**
 * Copy directory contents recursively with sudo (copies INTO dest, not nesting)
 */
function sudoCopyDir(src: string, dest: string): { success: boolean; error?: string } {
  return sudoExec(`cp -R "${src}/." "${dest}/"`);
}

/**
 * Resolve the real user's home directory.
 * When running under sudo, os.homedir() returns /root — use SUDO_USER to find the original user.
 */
function getRealUserHome(): string {
  const sudoUser = process.env['SUDO_USER'];
  if (sudoUser) {
    const userHome = path.join('/Users', sudoUser);
    if (fs.existsSync(userHome)) return userHome;
  }
  return os.homedir();
}

/**
 * Dev test harness preset implementation
 */
export const devHarnessPreset: TargetPreset = {
  id: 'dev-harness',
  name: 'Dev Test Harness',
  description: 'AgenShield test harness (dummy-openclaw)',

  async detect(): Promise<PresetDetectionResult | null> {
    // Check for dummy-openclaw.js binary
    const dummyOpenclawPath = path.join(process.cwd(), 'tools/test-harness/bin/dummy-openclaw.js');
    if (fs.existsSync(dummyOpenclawPath)) {
      const testHarnessDir = path.join(process.cwd(), 'tools/test-harness');
      const pkgPath = path.join(testHarnessDir, 'package.json');
      let version = '1.0.0-dummy';

      if (fs.existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
          if (pkg.name === 'dummy-openclaw') {
            version = pkg.version || version;
          }
        } catch {
          // Use default version
        }
      }

      const HOME = getRealUserHome();
      const configPath = fs.existsSync(path.join(HOME, '.openclaw-dev'))
        ? path.join(HOME, '.openclaw-dev')
        : fs.existsSync(path.join(HOME, '.openclaw'))
          ? path.join(HOME, '.openclaw')
          : undefined;

      return {
        found: true,
        version,
        packagePath: testHarnessDir,
        binaryPath: path.resolve(dummyOpenclawPath),
        configPath,
        method: 'custom',
      };
    }

    // Fallback: check package.json to confirm it's the test harness directory
    const testHarnessDir = path.join(process.cwd(), 'tools/test-harness');
    const pkgPath = path.join(testHarnessDir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkg.name === 'dummy-openclaw') {
          const HOME = getRealUserHome();
          const configPath = fs.existsSync(path.join(HOME, '.openclaw-dev'))
            ? path.join(HOME, '.openclaw-dev')
            : fs.existsSync(path.join(HOME, '.openclaw'))
              ? path.join(HOME, '.openclaw')
              : undefined;

          return {
            found: true,
            version: pkg.version || '1.0.0-dummy',
            packagePath: testHarnessDir,
            binaryPath: path.join(testHarnessDir, 'bin/dummy-openclaw.js'),
            configPath,
            method: 'custom',
          };
        }
      } catch {
        // Not our package
      }
    }

    return null;
  },

  async migrate(context: MigrationContext): Promise<PresetMigrationResult> {
    if (!context.detection?.binaryPath || !context.detection?.packagePath) {
      return { success: false, error: 'Dev test harness not detected' };
    }

    try {
      const packagePath = context.detection.packagePath;
      const packageDir = context.directories.packageDir;

      // Copy the entire test-harness directory to the sandbox package dir
      // (includes package.json so npm install can resolve dependencies)
      const copyResult = sudoCopyDir(packagePath, packageDir);
      if (!copyResult.success) {
        return { success: false, error: `Failed to copy package: ${copyResult.error}` };
      }

      // Install dependencies in the copied package directory
      const installResult = sudoExec(`npm install --production --prefix "${packageDir}"`);
      if (!installResult.success) {
        return { success: false, error: `Failed to install dependencies: ${installResult.error}` };
      }

      // Set ownership of copied files
      const ownResult = sudoExec(
        `chown -R ${context.agentUser.username}:${context.agentUser.gid} "${packageDir}"`
      );
      if (!ownResult.success) {
        return { success: false, error: `Failed to set ownership: ${ownResult.error}` };
      }

      // Create wrapper script that invokes the test harness via node
      const wrapperPath = path.join(context.directories.binDir, 'openclaw');
      const entryPath = path.join(packageDir, 'bin', 'dummy-openclaw.js');
      const binDir = context.directories.binDir;
      const wrapperContent = `#!/bin/bash
set -euo pipefail
export PATH="${binDir}:\${PATH:-/usr/bin:/bin}"
cd "${packageDir}"
exec node "${entryPath}" "$@"
`;
      // binDir is root-owned, use sudo to write wrapper
      const writeResult = sudoExec(`tee "${wrapperPath}" > /dev/null << 'WRAPEOF'
${wrapperContent}
WRAPEOF`);
      if (!writeResult.success) {
        return { success: false, error: `Failed to create wrapper: ${writeResult.error}` };
      }
      sudoExec(`chmod 755 "${wrapperPath}"`);

      // Forward OpenClaw config to sandbox (excluding skills/ and secrets)
      if (context.detection?.configPath && fs.existsSync(context.detection.configPath)) {
        const agentConfigDir = path.join(context.agentUser.home, '.openclaw');

        // Copy config contents (using /. to copy into existing dir, not nest)
        const configResult = sudoExec(
          `cp -R "${context.detection.configPath}/." "${agentConfigDir}/"`
        );

        if (configResult.success) {
          // Remove secrets (matching migration.ts pattern)
          sudoExec(`rm -f "${agentConfigDir}/secrets.json" 2>/dev/null`);
          sudoExec(`rm -f "${agentConfigDir}/.env" 2>/dev/null`);
          sudoExec(`rm -f "${agentConfigDir}/credentials.json" 2>/dev/null`);

          // Remove skills/ — skills go through quarantine/approval system
          sudoExec(`rm -rf "${agentConfigDir}/skills" 2>/dev/null`);

          // Set ownership
          sudoExec(
            `chown -R ${context.agentUser.username}:${context.agentUser.gid} "${agentConfigDir}"`
          );
        }
        // Config copy failure is non-fatal
      }

      return {
        success: true,
        newPaths: {
          packagePath: packageDir,
          binaryPath: wrapperPath,
          configPath: path.join(context.agentUser.home, '.openclaw'),
        },
      };
    } catch (err) {
      return {
        success: false,
        error: `Failed to migrate dev test harness: ${(err as Error).message}`,
      };
    }
  },

  getEntryCommand(context: MigrationContext): string {
    return path.join(context.directories.binDir, 'openclaw');
  },
};
