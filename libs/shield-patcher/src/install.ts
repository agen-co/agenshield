/**
 * Python Patcher Installation
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { PatcherConfig, PatcherResult } from './types.js';
import {
  generateSitecustomize,
  generatePythonWrapper,
  generateSandboxProfile,
} from './python/index.js';

const execAsync = promisify(exec);

export class PythonPatcher {
  private config: PatcherConfig;

  constructor(config: Partial<PatcherConfig> & { pythonPath: string }) {
    this.config = {
      pythonPath: config.pythonPath,
      brokerHost: config.brokerHost || 'localhost',
      brokerPort: config.brokerPort || 6969,
      useSandbox: config.useSandbox ?? true,
      workspacePath: config.workspacePath || '/Users/clawagent/workspace',
      socketPath: config.socketPath || '/var/run/agenshield.sock',
      installDir: config.installDir,
    };
  }

  /**
   * Install the Python patcher
   */
  async install(): Promise<PatcherResult> {
    try {
      // Get Python site-packages directory
      const sitePackages = await this.getSitePackagesDir();

      // Generate and write sitecustomize.py
      const sitecustomizePath = path.join(sitePackages, 'sitecustomize.py');
      const sitecustomizeContent = generateSitecustomize({
        brokerHost: this.config.brokerHost,
        brokerPort: this.config.brokerPort,
        logLevel: 'warn',
        enabled: true,
      });

      await fs.writeFile(sitecustomizePath, sitecustomizeContent, {
        mode: 0o644,
      });

      const result: PatcherResult = {
        success: true,
        message: 'Python patcher installed successfully',
        paths: {
          sitecustomize: sitecustomizePath,
        },
      };

      // Install wrapper script if install directory specified
      if (this.config.installDir) {
        const wrapperPath = path.join(this.config.installDir, 'python');
        const wrapperContent = generatePythonWrapper({
          pythonPath: this.config.pythonPath,
          sitecustomizePath,
          useSandbox: this.config.useSandbox,
          sandboxProfilePath: this.config.useSandbox
            ? '/etc/agenshield/seatbelt/python.sb'
            : undefined,
        });

        await fs.writeFile(wrapperPath, wrapperContent, { mode: 0o755 });
        result.paths!.wrapper = wrapperPath;

        // Install sandbox profile if using sandbox
        if (this.config.useSandbox) {
          const profilePath = '/etc/agenshield/seatbelt/python.sb';
          const profileDir = path.dirname(profilePath);

          await fs.mkdir(profileDir, { recursive: true });

          const profileContent = generateSandboxProfile({
            workspacePath: this.config.workspacePath,
            pythonPath: this.config.pythonPath,
            brokerHost: this.config.brokerHost,
            brokerPort: this.config.brokerPort,
          });

          await fs.writeFile(profilePath, profileContent, { mode: 0o644 });
          result.paths!.sandboxProfile = profilePath;
        }
      }

      return result;
    } catch (error) {
      return {
        success: false,
        message: `Installation failed: ${(error as Error).message}`,
        error: error as Error,
      };
    }
  }

  /**
   * Uninstall the Python patcher
   */
  async uninstall(): Promise<PatcherResult> {
    try {
      const sitePackages = await this.getSitePackagesDir();
      const sitecustomizePath = path.join(sitePackages, 'sitecustomize.py');

      // Check if our sitecustomize is installed
      try {
        const content = await fs.readFile(sitecustomizePath, 'utf-8');
        if (!content.includes('AgenShield')) {
          return {
            success: false,
            message: 'sitecustomize.py does not appear to be AgenShield installation',
          };
        }

        await fs.unlink(sitecustomizePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }

      // Remove wrapper if exists
      if (this.config.installDir) {
        const wrapperPath = path.join(this.config.installDir, 'python');
        try {
          await fs.unlink(wrapperPath);
        } catch {
          // Ignore if doesn't exist
        }
      }

      return {
        success: true,
        message: 'Python patcher uninstalled successfully',
      };
    } catch (error) {
      return {
        success: false,
        message: `Uninstallation failed: ${(error as Error).message}`,
        error: error as Error,
      };
    }
  }

  /**
   * Check if patcher is installed
   */
  async isInstalled(): Promise<boolean> {
    try {
      const sitePackages = await this.getSitePackagesDir();
      const sitecustomizePath = path.join(sitePackages, 'sitecustomize.py');

      const content = await fs.readFile(sitecustomizePath, 'utf-8');
      return content.includes('AgenShield');
    } catch {
      return false;
    }
  }

  /**
   * Get Python version
   */
  async getPythonVersion(): Promise<string> {
    const { stdout } = await execAsync(`${this.config.pythonPath} --version`);
    return stdout.trim();
  }

  /**
   * Get site-packages directory
   */
  private async getSitePackagesDir(): Promise<string> {
    const { stdout } = await execAsync(
      `${this.config.pythonPath} -c "import site; print(site.getsitepackages()[0])"`
    );
    return stdout.trim();
  }
}
