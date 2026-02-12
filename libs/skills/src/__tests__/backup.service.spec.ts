/**
 * SkillBackupService tests — real filesystem with tmp dirs
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { SkillBackupService } from '../backup';

describe('SkillBackupService', () => {
  let tmpDir: string;
  let backupDir: string;
  let service: SkillBackupService;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-test-'));
    backupDir = path.join(tmpDir, 'backup');
    fs.mkdirSync(backupDir, { recursive: true });
    service = new SkillBackupService(backupDir);
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* */ }
  });

  it('saveFiles creates nested directory structure and writes correct content', () => {
    service.saveFiles('v1', [
      { relativePath: 'index.ts', content: Buffer.from('export default {}') },
      { relativePath: 'src/lib/util.ts', content: Buffer.from('export const x = 1') },
    ]);

    expect(fs.existsSync(path.join(backupDir, 'v1', 'index.ts'))).toBe(true);
    expect(fs.existsSync(path.join(backupDir, 'v1', 'src', 'lib', 'util.ts'))).toBe(true);
    expect(fs.readFileSync(path.join(backupDir, 'v1', 'index.ts'), 'utf-8')).toBe('export default {}');
    expect(fs.readFileSync(path.join(backupDir, 'v1', 'src', 'lib', 'util.ts'), 'utf-8')).toBe('export const x = 1');
  });

  it('loadFiles returns Map keyed by relativePath with correct Buffer content', () => {
    service.saveFiles('v1', [
      { relativePath: 'a.ts', content: Buffer.from('aaa') },
      { relativePath: 'b.ts', content: Buffer.from('bbb') },
    ]);

    const loaded = service.loadFiles('v1');
    expect(loaded.size).toBe(2);
    expect(loaded.get('a.ts')!.toString()).toBe('aaa');
    expect(loaded.get('b.ts')!.toString()).toBe('bbb');
  });

  it('loadFiles handles nested subdirectories', () => {
    service.saveFiles('v1', [
      { relativePath: 'src/lib/util.ts', content: Buffer.from('nested content') },
    ]);

    const loaded = service.loadFiles('v1');
    expect(loaded.size).toBe(1);
    expect(loaded.get('src/lib/util.ts')!.toString()).toBe('nested content');
  });

  it('loadFiles returns empty Map when backup dir does not exist', () => {
    const loaded = service.loadFiles('nonexistent-version');
    expect(loaded.size).toBe(0);
  });

  it('removeFiles deletes the entire version backup directory', () => {
    service.saveFiles('v1', [
      { relativePath: 'a.ts', content: Buffer.from('aaa') },
      { relativePath: 'sub/b.ts', content: Buffer.from('bbb') },
    ]);

    expect(fs.existsSync(path.join(backupDir, 'v1'))).toBe(true);
    service.removeFiles('v1');
    expect(fs.existsSync(path.join(backupDir, 'v1'))).toBe(false);
  });

  it('removeFiles is a no-op when backup dir does not exist', () => {
    expect(() => service.removeFiles('nonexistent-version')).not.toThrow();
  });

  it('hasBackup returns true after saveFiles, false before and after removeFiles', () => {
    expect(service.hasBackup('v1')).toBe(false);

    service.saveFiles('v1', [
      { relativePath: 'a.ts', content: Buffer.from('aaa') },
    ]);
    expect(service.hasBackup('v1')).toBe(true);

    service.removeFiles('v1');
    expect(service.hasBackup('v1')).toBe(false);
  });

  describe('loadFile', () => {
    it('returns Buffer for existing file', () => {
      service.saveFiles('v1', [
        { relativePath: 'SKILL.md', content: Buffer.from('# My Skill') },
        { relativePath: 'index.ts', content: Buffer.from('export default {}') },
      ]);

      const buf = service.loadFile('v1', 'SKILL.md');
      expect(buf).not.toBeNull();
      expect(buf!.toString()).toBe('# My Skill');
    });

    it('returns null for missing file', () => {
      service.saveFiles('v1', [
        { relativePath: 'index.ts', content: Buffer.from('export default {}') },
      ]);

      expect(service.loadFile('v1', 'SKILL.md')).toBeNull();
    });

    it('returns null for missing version', () => {
      expect(service.loadFile('nonexistent-version', 'SKILL.md')).toBeNull();
    });
  });

  describe('loadSkillMd', () => {
    it('finds SKILL.md', () => {
      service.saveFiles('v1', [
        { relativePath: 'SKILL.md', content: Buffer.from('# Skill Content') },
        { relativePath: 'index.ts', content: Buffer.from('code') },
      ]);

      expect(service.loadSkillMd('v1')).toBe('# Skill Content');
    });

    it('falls back to README.md', () => {
      service.saveFiles('v1', [
        { relativePath: 'README.md', content: Buffer.from('# Readme Content') },
        { relativePath: 'index.ts', content: Buffer.from('code') },
      ]);

      expect(service.loadSkillMd('v1')).toBe('# Readme Content');
    });

    it('returns null when no markdown file exists', () => {
      service.saveFiles('v1', [
        { relativePath: 'index.ts', content: Buffer.from('code') },
        { relativePath: 'config.json', content: Buffer.from('{}') },
      ]);

      expect(service.loadSkillMd('v1')).toBeNull();
    });
  });
});
