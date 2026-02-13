/**
 * Daemon Deploy Adapter
 *
 * Extends the generic OpenClaw deploy adapter with daemon-specific capabilities:
 * - Broker-based file operations (privileged writes)
 * - sudo fallback for non-broker deployments
 * - Skill wrapper creation/removal
 * - Policy management (add/remove skill policies in daemon config)
 * - Ownership (chown root:<socketGroup>)
 * - Installation tag injection
 * - Preset policy support for master AgenCo skill
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import type { Skill, SkillVersion, SkillFile, SkillInstallation } from '@agenshield/ipc';
import { AGENCO_PRESET } from '@agenshield/ipc';
import { stripEnvFromSkillMd } from '@agenshield/sandbox';
import type { DeployAdapter, DeployContext, DeployResult, IntegrityCheckResult } from '@agentshield/skills';
import {
  installSkillViaBroker,
  uninstallSkillViaBroker,
  isBrokerAvailable,
} from '../services/broker-bridge';
import {
  addSkillPolicy,
  removeSkillPolicy,
  createSkillWrapper,
  removeSkillWrapper,
  removeBrewBinaryWrappers,
  sudoMkdir,
  sudoWriteFile,
  sudoRm,
} from '../services/skill-lifecycle';
import { injectInstallationTag } from '../services/skill-tag-injector';
import { loadConfig, updateConfig } from '../config';
import { syncCommandPolicies } from '../command-sync';

export interface DaemonDeployAdapterOptions {
  /** Directory where skill files are deployed */
  skillsDir: string;
  /** Agent home directory (e.g. /Users/ash_default_agent) */
  agentHome: string;
  /** Socket group for chown (e.g. ash_default) */
  socketGroup: string;
  /** Bin directory for wrapper scripts */
  binDir: string;
  /** When true, skip broker/sudo/chown and use plain fs operations */
  devMode?: boolean;
}

export class DaemonDeployAdapter implements DeployAdapter {
  readonly id = 'daemon';
  readonly displayName = 'Daemon (broker/sudo)';

  private readonly skillsDir: string;
  private readonly agentHome: string;
  private readonly socketGroup: string;
  private readonly binDir: string;
  private readonly devMode: boolean;

  constructor(options: DaemonDeployAdapterOptions) {
    this.skillsDir = options.skillsDir;
    this.agentHome = options.agentHome;
    this.socketGroup = options.socketGroup;
    this.binDir = options.binDir;
    this.devMode = options.devMode ?? false;
  }

  canDeploy(targetId: string | undefined): boolean {
    return targetId === undefined || targetId === 'daemon' || targetId === 'openclaw';
  }

  async deploy(context: DeployContext): Promise<DeployResult> {
    const { skill, version, files, fileContents } = context;
    const destDir = path.join(this.skillsDir, skill.slug);
    const agentUsername = path.basename(this.agentHome);

    // 1. Process files: strip env vars and inject installation tags
    const processedFiles = await this.processFiles(files, version, fileContents);

    // 2. Write files via dev fs, broker, or sudo fallback
    if (this.devMode) {
      fs.mkdirSync(destDir, { recursive: true });
      for (const file of processedFiles) {
        const filePath = path.join(destDir, file.relativePath);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, file.content, 'utf-8');
      }
      this.createDevWrapper(skill.slug);
    } else {
      const brokerAvailable = await isBrokerAvailable();

      if (brokerAvailable) {
        const brokerResult = await installSkillViaBroker(
          skill.slug,
          processedFiles.map((f) => ({ name: f.relativePath, content: f.content })),
          { createWrapper: true, agentHome: this.agentHome, socketGroup: this.socketGroup },
        );
        if (!brokerResult.installed) {
          throw new Error('Broker failed to install skill files');
        }
      } else {
        // Fallback: direct fs operations with sudo
        await sudoMkdir(destDir, agentUsername);
        for (const file of processedFiles) {
          const filePath = path.join(destDir, file.relativePath);
          await sudoMkdir(path.dirname(filePath), agentUsername);
          await sudoWriteFile(filePath, file.content, agentUsername);
        }

        // Set ownership
        try {
          execSync(`chown -R root:${this.socketGroup} "${destDir}"`, { stdio: 'pipe' });
          execSync(`chmod -R a+rX,go-w "${destDir}"`, { stdio: 'pipe' });
        } catch {
          // May fail if not root — acceptable in development
        }

        // Create wrapper
        await createSkillWrapper(skill.slug, this.binDir);
      }
    }

    // 3. Add policy
    addSkillPolicy(skill.slug);

    // 4. Handle preset policies for master AgenCo skill
    if (context.installation.targetId === undefined || context.skill.slug === 'ag-agenco') {
      this.applyPresetPolicies(version);
    }

    // 5. Compute deployed hash
    const deployedHash = this.computeDeployedHash(destDir, processedFiles);

    return {
      deployedPath: destDir,
      deployedHash,
      wrapperPath: path.join(this.binDir, skill.slug),
    };
  }

  async undeploy(installation: SkillInstallation, version: SkillVersion, skill: Skill): Promise<void> {
    const destDir = path.join(this.skillsDir, skill.slug);
    const agentUsername = path.basename(this.agentHome);

    // 1. Remove files via dev fs, broker, or sudo fallback
    if (this.devMode) {
      if (fs.existsSync(destDir)) {
        fs.rmSync(destDir, { recursive: true, force: true });
      }
      removeSkillWrapper(skill.slug, this.binDir);
    } else {
      const brokerAvailable = await isBrokerAvailable();
      if (brokerAvailable) {
        try {
          await uninstallSkillViaBroker(skill.slug, {
            removeWrapper: true,
            agentHome: this.agentHome,
          });
        } catch {
          // Fallback to direct removal
          if (fs.existsSync(destDir)) {
            await sudoRm(destDir, agentUsername);
          }
          removeSkillWrapper(skill.slug, this.binDir);
        }
      } else {
        if (fs.existsSync(destDir)) {
          await sudoRm(destDir, agentUsername);
        }
        removeSkillWrapper(skill.slug, this.binDir);
      }
    }

    // 2. Remove policy
    removeSkillPolicy(skill.slug);

    // 3. Remove brew binary wrappers
    await removeBrewBinaryWrappers(skill.slug);

    // 4. Handle master skill: remove preset policies
    if (skill.slug === 'ag-agenco') {
      const config = loadConfig();
      const agencoIds = new Set(AGENCO_PRESET.policies.map((p) => p.id));
      const filtered = config.policies.filter((p) => !agencoIds.has(p.id));
      if (filtered.length !== config.policies.length) {
        updateConfig({ policies: filtered });
        syncCommandPolicies(filtered);
      }
    }
  }

  async checkIntegrity(
    installation: SkillInstallation,
    version: SkillVersion,
    files: SkillFile[],
  ): Promise<IntegrityCheckResult> {
    // Derive slug from folder path pattern /skills/{slug}/{version}
    const pathParts = version.folderPath.split('/').filter(Boolean);
    const skillSlug = pathParts.length >= 2 ? pathParts[pathParts.length - 2] : pathParts[0];
    const deployDir = path.join(this.skillsDir, skillSlug);

    const modifiedFiles: string[] = [];
    const missingFiles: string[] = [];

    for (const file of files) {
      const deployedPath = path.join(deployDir, file.relativePath);

      if (!fs.existsSync(deployedPath)) {
        missingFiles.push(file.relativePath);
        continue;
      }

      const content = fs.readFileSync(deployedPath);
      const hash = crypto.createHash('sha256').update(content).digest('hex');
      if (hash !== file.fileHash) {
        modifiedFiles.push(file.relativePath);
      }
    }

    // Check for unexpected files on disk
    const unexpectedFiles: string[] = [];
    if (fs.existsSync(deployDir)) {
      const knownPaths = new Set(files.map((f) => f.relativePath));
      const diskFiles = this.listFilesRecursive(deployDir);
      for (const diskFile of diskFiles) {
        const rel = path.relative(deployDir, diskFile);
        if (!knownPaths.has(rel)) {
          unexpectedFiles.push(rel);
        }
      }
    }

    const intact = modifiedFiles.length === 0 && missingFiles.length === 0 && unexpectedFiles.length === 0;
    return { intact, modifiedFiles, missingFiles, unexpectedFiles };
  }

  // ─── Private Helpers ────────────────────────────────────────

  private async processFiles(
    files: SkillFile[],
    version: SkillVersion,
    fileContents?: Map<string, Buffer>,
  ): Promise<Array<{ relativePath: string; content: string }>> {
    const processed: Array<{ relativePath: string; content: string }> = [];

    // Extract slug from folderPath pattern: /skills/{slug}/{version}
    const pathParts = version.folderPath.split('/').filter(Boolean);
    const skillSlug = pathParts.length >= 2 ? pathParts[pathParts.length - 2] : pathParts[0];

    for (const file of files) {
      let content: string;

      // Prefer backup content (trusted original) when available
      const stored = fileContents?.get(file.relativePath);
      if (stored) {
        content = stored.toString('utf-8');
      } else {
        // Fallback: read from disk
        const srcPath = path.join(version.folderPath, file.relativePath);
        try {
          content = fs.readFileSync(srcPath, 'utf-8');
        } catch {
          // If source path doesn't exist, try skills dir with slug prefix
          const altPath = path.join(this.skillsDir, skillSlug, file.relativePath);
          try {
            content = fs.readFileSync(altPath, 'utf-8');
          } catch {
            continue; // Skip unreadable files
          }
        }
      }

      // Process SKILL.md files
      if (/SKILL\.md$/i.test(file.relativePath)) {
        content = stripEnvFromSkillMd(content);
        content = await injectInstallationTag(content);
      }

      processed.push({ relativePath: file.relativePath, content });
    }

    return processed;
  }

  private computeDeployedHash(dir: string, files: Array<{ relativePath: string; content: string }>): string {
    const sorted = [...files].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    const hash = crypto.createHash('sha256');
    for (const file of sorted) {
      hash.update(file.relativePath);
      hash.update(file.content);
    }
    return hash.digest('hex');
  }

  private applyPresetPolicies(version: SkillVersion): void {
    try {
      const metadata = version.metadataJson as Record<string, unknown> | undefined;
      const presetPolicies = metadata?.['presetPolicies'] as typeof AGENCO_PRESET.policies | undefined;
      if (!presetPolicies) return;

      const config = loadConfig();
      let changed = false;
      for (const presetPolicy of presetPolicies) {
        if (!config.policies.some((p) => p.id === presetPolicy.id)) {
          config.policies.push(presetPolicy);
          changed = true;
        }
      }
      if (changed) {
        updateConfig({ policies: config.policies });
        syncCommandPolicies(config.policies);
      }
    } catch {
      // Best-effort preset policy application
    }
  }

  /**
   * Create a simple dev wrapper script that logs invocations.
   * Used in dev mode instead of the production `createSkillWrapper`.
   */
  private createDevWrapper(slug: string): void {
    fs.mkdirSync(this.binDir, { recursive: true });
    const wrapperPath = path.join(this.binDir, slug);
    const content = [
      '#!/usr/bin/env bash',
      `# Dev wrapper for skill: ${slug}`,
      `echo "[dev-wrapper] ${slug} invoked with args: $@"`,
      '',
    ].join('\n');
    fs.writeFileSync(wrapperPath, content, { mode: 0o755 });
  }

  private listFilesRecursive(dir: string): string[] {
    const results: string[] = [];
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          results.push(...this.listFilesRecursive(fullPath));
        } else {
          results.push(fullPath);
        }
      }
    } catch {
      // Directory unreadable
    }
    return results;
  }
}
