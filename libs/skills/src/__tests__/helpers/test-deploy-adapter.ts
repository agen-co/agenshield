/**
 * Test-only filesystem deploy adapter for integration tests that need real file I/O.
 *
 * Extracted from the removed OpenClawDeployAdapter — minimal, no wrapper creation.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { Skill, SkillVersion, SkillFile, SkillInstallation } from '@agenshield/ipc';
import type { DeployAdapter, DeployContext, DeployResult, IntegrityCheckResult } from '../../deploy/types';

export interface TestDeployAdapterOptions {
  skillsDir: string;
}

export class TestDeployAdapter implements DeployAdapter {
  readonly id = 'test';
  readonly displayName = 'Test';

  private readonly skillsDir: string;

  constructor(options: TestDeployAdapterOptions) {
    this.skillsDir = path.resolve(options.skillsDir);
  }

  canDeploy(_profileId: string | undefined): boolean {
    return true;
  }

  async deploy(context: DeployContext): Promise<DeployResult> {
    const { skill, version, files, fileContents } = context;
    const destDir = path.join(this.skillsDir, skill.slug);

    fs.mkdirSync(destDir, { recursive: true });

    for (const file of files) {
      const destPath = path.join(destDir, file.relativePath);
      fs.mkdirSync(path.dirname(destPath), { recursive: true });

      const stored = fileContents?.get(file.relativePath);
      if (stored) {
        fs.writeFileSync(destPath, stored);
      } else {
        const srcPath = path.join(version.folderPath, file.relativePath);
        if (fs.existsSync(srcPath)) {
          fs.copyFileSync(srcPath, destPath);
        }
      }
    }

    const deployedHash = this.computeDeployedHash(destDir, files);

    return { deployedPath: destDir, deployedHash };
  }

  async undeploy(_installation: SkillInstallation, _version: SkillVersion, skill: Skill): Promise<void> {
    const destDir = path.join(this.skillsDir, skill.slug);
    if (fs.existsSync(destDir)) {
      fs.rmSync(destDir, { recursive: true });
    }
  }

  async checkIntegrity(_installation: SkillInstallation, _version: SkillVersion, files: SkillFile[], skill: Skill): Promise<IntegrityCheckResult> {
    const deployDir = path.join(this.skillsDir, skill.slug);

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
    return { intact, modifiedFiles, missingFiles, unexpectedFiles, checkedPath: deployDir };
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

  private listFilesRecursive(dir: string): string[] {
    const results: string[] = [];
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
    return results;
  }
}
