/**
 * E2E Test: Bash Scripts
 *
 * Tests the bash scripts in tools/test-harness/scripts/ and scripts/:
 * - install-as-npm.sh (already installed by global setup, just verify)
 * - install-as-git.sh
 * - uninstall.sh
 * - get-lib-version.sh
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { runShell, getRootDir } from '../setup/helpers';

const ROOT = getRootDir();

describe('bash scripts', () => {
  describe('install-as-npm.sh verification', () => {
    // The test harness was already installed by global-setup via npm link.
    // We verify that the installation worked.

    it('should have openclaw command available globally', () => {
      const result = runShell('which openclaw');
      expect(result.exitCode).toBe(0);
    });

    it('should report correct version', () => {
      const result = runShell('openclaw --version');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('1.0.0-dummy');
    });

    it('should show help output', () => {
      const result = runShell('openclaw --help');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Dummy OpenClaw');
    });
  });

  describe('install-as-git.sh', () => {
    const targetDir = '/tmp/e2e-openclaw-git-clone';

    afterAll(() => {
      try {
        fs.rmSync(targetDir, { recursive: true, force: true });
      } catch {
        // Ignore
      }
    });

    it('should install test harness as git clone', () => {
      // Clean up first if leftover from a previous failed run
      try {
        fs.rmSync(targetDir, { recursive: true, force: true });
      } catch {
        // Ignore
      }

      const result = runShell(
        `bash tools/test-harness/scripts/install-as-git.sh ${targetDir}`,
        { timeout: 60_000 }
      );
      expect(result.exitCode).toBe(0);
    });

    it('should create the target directory', () => {
      expect(fs.existsSync(targetDir)).toBe(true);
    });

    it('should have bin directory with dummy-openclaw.js', () => {
      const binPath = path.join(targetDir, 'bin', 'dummy-openclaw.js');
      expect(fs.existsSync(binPath)).toBe(true);
    });

    it('should make the binary executable', () => {
      const binPath = path.join(targetDir, 'bin', 'dummy-openclaw.js');
      const stat = fs.statSync(binPath);
      // Check execute bit (owner)
      expect(stat.mode & 0o100).toBeTruthy();
    });

    it('should be runnable from the clone directory', () => {
      const binPath = path.join(targetDir, 'bin', 'dummy-openclaw.js');
      const result = runShell(`node ${binPath} --version`);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('1.0.0-dummy');
    });

    it('should have package.json in the clone', () => {
      expect(fs.existsSync(path.join(targetDir, 'package.json'))).toBe(true);
    });

    it('should clean up with uninstall.sh --git-clone', () => {
      const result = runShell(
        `bash tools/test-harness/scripts/uninstall.sh --git-clone ${targetDir}`
      );
      expect(result.exitCode).toBe(0);
      expect(fs.existsSync(targetDir)).toBe(false);
    });
  });

  describe('get-lib-version.sh', () => {
    const scriptPath = path.join(ROOT, 'scripts/get-lib-version.sh');
    const scriptExists = fs.existsSync(scriptPath);

    // Skip all tests if script doesn't exist (some setups may not have it)
    const testFn = scriptExists ? it : it.skip;

    testFn('should return a version for shield-ipc', () => {
      const result = runShell('bash scripts/get-lib-version.sh shield-ipc');
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    });

    testFn('should return a version for shield-daemon', () => {
      const result = runShell('bash scripts/get-lib-version.sh shield-daemon');
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    });

    testFn('should reject path traversal attempts', () => {
      const result = runShell(
        'bash scripts/get-lib-version.sh "../../../etc/passwd"'
      );
      expect(result.exitCode).not.toBe(0);
    });

    testFn('should reject names with special characters', () => {
      const result = runShell('bash scripts/get-lib-version.sh "foo;rm -rf /"');
      expect(result.exitCode).not.toBe(0);
    });

    testFn('should fail for non-existent library', () => {
      const result = runShell(
        'bash scripts/get-lib-version.sh nonexistent-library-xyz'
      );
      expect(result.exitCode).not.toBe(0);
    });
  });
});
