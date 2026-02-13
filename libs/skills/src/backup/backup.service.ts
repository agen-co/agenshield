/**
 * Skill backup service — filesystem-backed backup of skill file content
 *
 * Stores copies of skill files at {backupDir}/{versionId}/{relativePath}
 * so they can be restored during reinstall when disk files are tampered with.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export class SkillBackupService {
  constructor(private readonly backupDir: string) {}

  /** Save file contents to backup dir */
  saveFiles(versionId: string, files: Array<{ relativePath: string; content: Buffer }>): void {
    for (const f of files) {
      const dest = path.join(this.backupDir, versionId, f.relativePath);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, f.content);
    }
  }

  /** Load all backup files for a version, keyed by relativePath */
  loadFiles(versionId: string): Map<string, Buffer> {
    const result = new Map<string, Buffer>();
    const dir = path.join(this.backupDir, versionId);
    if (!fs.existsSync(dir)) return result;
    this.collectRecursive(dir, dir, result);
    return result;
  }

  /** Remove backup for a version */
  removeFiles(versionId: string): void {
    const dir = path.join(this.backupDir, versionId);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }

  /** Check if backup exists for a version */
  hasBackup(versionId: string): boolean {
    return fs.existsSync(path.join(this.backupDir, versionId));
  }

  /** Load a single file from backup by relative path */
  loadFile(versionId: string, relativePath: string): Buffer | null {
    const filePath = path.join(this.backupDir, versionId, relativePath);
    try {
      return fs.readFileSync(filePath);
    } catch {
      return null;
    }
  }

  /** Load SKILL.md (or fallback names) from backup */
  loadSkillMd(versionId: string): string | null {
    const candidates = ['SKILL.md', 'skill.md', 'README.md', 'readme.md'];
    for (const name of candidates) {
      const buf = this.loadFile(versionId, name);
      if (buf) return buf.toString('utf-8');
    }
    return null;
  }

  private collectRecursive(dir: string, base: string, result: Map<string, Buffer>): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        this.collectRecursive(fullPath, base, result);
      } else if (entry.isFile()) {
        const relativePath = path.relative(base, fullPath);
        result.set(relativePath, fs.readFileSync(fullPath));
      }
    }
  }
}
