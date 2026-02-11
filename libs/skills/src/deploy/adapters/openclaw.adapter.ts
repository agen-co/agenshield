/**
 * OpenClaw deploy adapter — deploys skills to the OpenClaw workspace filesystem
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { Skill, SkillVersion, SkillFile, SkillInstallation } from '@agenshield/ipc';
import type { DeployAdapter, DeployContext, DeployResult, IntegrityCheckResult } from '../types';

export interface OpenClawDeployAdapterOptions {
  /** Directory where skill files are deployed (e.g. ~/.openclaw/workspace/skills) */
  skillsDir: string;
  /** Optional directory for wrapper scripts (e.g. ~/bin) */
  binDir?: string;
  /** Whether to create executable bash wrapper scripts (default: true) */
  createWrappers?: boolean;
}

export class OpenClawDeployAdapter implements DeployAdapter {
  readonly id = 'openclaw';
  readonly displayName = 'OpenClaw';

  private readonly skillsDir: string;
  private readonly binDir?: string;
  private readonly createWrappers: boolean;

  constructor(options: OpenClawDeployAdapterOptions) {
    this.skillsDir = options.skillsDir;
    this.binDir = options.binDir;
    this.createWrappers = options.createWrappers ?? true;
  }

  canDeploy(targetId: string | undefined): boolean {
    return targetId === undefined || targetId === 'openclaw';
  }

  async deploy(context: DeployContext): Promise<DeployResult> {
    const { skill, version, files } = context;
    const destDir = path.join(this.skillsDir, skill.slug);

    // Create destination directory
    fs.mkdirSync(destDir, { recursive: true });

    // Copy files from version folder to destination
    for (const file of files) {
      const srcPath = path.join(version.folderPath, file.relativePath);
      const destPath = path.join(destDir, file.relativePath);

      // Ensure subdirectories exist
      fs.mkdirSync(path.dirname(destPath), { recursive: true });

      if (fs.existsSync(srcPath)) {
        fs.copyFileSync(srcPath, destPath);
      }
    }

    // Compute deployed hash from all files
    const deployedHash = this.computeDeployedHash(destDir, files);

    // Create wrapper script
    let wrapperPath: string | undefined;
    if (this.createWrappers && this.binDir) {
      wrapperPath = this.createWrapperScript(skill.slug, destDir);
    }

    return { deployedPath: destDir, deployedHash, wrapperPath };
  }

  async undeploy(installation: SkillInstallation, version: SkillVersion, skill: Skill): Promise<void> {
    const destDir = path.join(this.skillsDir, skill.slug);

    // Remove deployed skill directory
    if (fs.existsSync(destDir)) {
      fs.rmSync(destDir, { recursive: true });
    }

    // Remove wrapper script
    if (this.binDir) {
      const wrapperPath = path.join(this.binDir, skill.slug);
      if (fs.existsSync(wrapperPath)) {
        fs.unlinkSync(wrapperPath);
      }
    }
  }

  async checkIntegrity(installation: SkillInstallation, version: SkillVersion, files: SkillFile[]): Promise<IntegrityCheckResult> {
    const destDir = path.join(this.skillsDir, version.folderPath.split('/').pop() === version.version
      ? path.basename(path.dirname(version.folderPath))
      : path.basename(version.folderPath));

    // We derive the destDir from the skill slug, which we can get from folderPath pattern /skills/{slug}/{version}
    const slugFromPath = version.folderPath.split('/').filter(Boolean);
    const skillSlug = slugFromPath.length >= 2 ? slugFromPath[slugFromPath.length - 2] : slugFromPath[0];
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

  private computeDeployedHash(dir: string, files: SkillFile[]): string {
    const hashes: string[] = [];

    for (const file of [...files].sort((a, b) => a.relativePath.localeCompare(b.relativePath))) {
      const filePath = path.join(dir, file.relativePath);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath);
        hashes.push(crypto.createHash('sha256').update(content).digest('hex'));
      }
    }

    return crypto.createHash('sha256').update(hashes.join('')).digest('hex');
  }

  private createWrapperScript(slug: string, skillDir: string): string {
    const wrapperPath = path.join(this.binDir!, slug);
    const script = `#!/bin/bash\n# Auto-generated wrapper for skill: ${slug}\nexec "${skillDir}/bin/${slug}" "$@"\n`;

    fs.mkdirSync(path.dirname(wrapperPath), { recursive: true });
    fs.writeFileSync(wrapperPath, script, { mode: 0o755 });

    return wrapperPath;
  }

  private listFilesRecursive(dir: string): string[] {
    const results: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...this.listFilesRecursive(fullPath));
      } else {
        results.push(fullPath);
      }
    }

    return results;
  }
}
