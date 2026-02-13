/**
 * Skill backup service — filesystem-backed backup of skill file content
 *
 * Stores copies of skill files at {backupDir}/{versionId}/{relativePath}
 * so they can be restored during reinstall when disk files are tampered with.
 *
 * Computes SHA-256 hashes over sorted (path + content) pairs for deterministic
 * tamper detection. The hash is stored in the DB and verified before restore.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

export class SkillBackupService {
  constructor(private readonly backupDir: string) {}

  /**
   * Save file contents to backup dir and return a SHA-256 hash of the backup.
   * The caller should store this hash in the DB for later verification.
   */
  saveFiles(versionId: string, files: Array<{ relativePath: string; content: Buffer }>): string {
    const hasher = crypto.createHash('sha256');

    // Sort for deterministic hashing
    const sorted = [...files].sort((a, b) => a.relativePath.localeCompare(b.relativePath));

    for (const f of sorted) {
      const dest = path.join(this.backupDir, versionId, f.relativePath);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, f.content);

      // Feed path + content into hash
      hasher.update(f.relativePath);
      hasher.update(f.content);
    }

    return hasher.digest('hex');
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

  /**
   * Verify the integrity of backup files against a stored hash.
   * Recomputes the hash from disk files and compares with timing-safe equality.
   * Returns true if the backup is intact, false if tampered or missing.
   */
  verifyIntegrity(versionId: string, expectedHash: string): boolean {
    const dir = path.join(this.backupDir, versionId);
    if (!fs.existsSync(dir)) return false;

    const files = new Map<string, Buffer>();
    this.collectRecursive(dir, dir, files);

    if (files.size === 0) return false;

    const hasher = crypto.createHash('sha256');

    // Sort for deterministic hashing (same order as saveFiles)
    const sorted = [...files.entries()].sort((a, b) => a[0].localeCompare(b[0]));

    for (const [relativePath, content] of sorted) {
      hasher.update(relativePath);
      hasher.update(content);
    }

    const computedHash = hasher.digest('hex');

    // Timing-safe comparison to prevent timing attacks
    const expected = Buffer.from(expectedHash, 'hex');
    const computed = Buffer.from(computedHash, 'hex');
    if (expected.length !== computed.length) return false;
    return crypto.timingSafeEqual(expected, computed);
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
