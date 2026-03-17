/**
 * Tests for MDM org config reader/writer
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadMdmConfig, saveMdmConfig, hasMdmConfig } from '../mdm-config';
import type { MdmOrgConfig } from '../types';

describe('MDM config', () => {
  let tmpDir: string;
  const origEnv = { ...process.env };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdm-test-'));
    process.env['AGENSHIELD_USER_HOME'] = tmpDir;
  });

  afterEach(() => {
    process.env = { ...origEnv };
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('saveMdmConfig', () => {
    it('should write config file', () => {
      const config: MdmOrgConfig = {
        orgClientId: 'org-123',
        cloudUrl: 'https://cloud.test',
        createdAt: '2025-01-01T00:00:00.000Z',
      };

      saveMdmConfig(config);

      const filePath = path.join(tmpDir, '.agenshield', 'mdm.json');
      expect(fs.existsSync(filePath)).toBe(true);

      const raw = fs.readFileSync(filePath, 'utf-8');
      const saved = JSON.parse(raw);
      expect(saved.orgClientId).toBe('org-123');
      expect(saved.cloudUrl).toBe('https://cloud.test');
    });
  });

  describe('loadMdmConfig', () => {
    it('should load a valid config', () => {
      const config: MdmOrgConfig = {
        orgClientId: 'org-456',
        cloudUrl: 'https://cloud.test',
        createdAt: '2025-01-01T00:00:00.000Z',
      };
      saveMdmConfig(config);

      const loaded = loadMdmConfig();
      expect(loaded).not.toBeNull();
      expect(loaded!.orgClientId).toBe('org-456');
    });

    it('should return null when file does not exist', () => {
      expect(loadMdmConfig()).toBeNull();
    });

    it('should return null for invalid JSON', () => {
      const dir = path.join(tmpDir, '.agenshield');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'mdm.json'), 'not json');
      expect(loadMdmConfig()).toBeNull();
    });

    it('should return null when missing required fields', () => {
      const dir = path.join(tmpDir, '.agenshield');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'mdm.json'),
        JSON.stringify({ orgClientId: '', cloudUrl: '' }),
      );
      expect(loadMdmConfig()).toBeNull();
    });

    it('should fall back to HOME env for path resolution', () => {
      delete process.env['AGENSHIELD_USER_HOME'];
      process.env['HOME'] = tmpDir;

      saveMdmConfig({
        orgClientId: 'org-home',
        cloudUrl: 'https://cloud.test',
        createdAt: '2025-01-01T00:00:00.000Z',
      });

      const loaded = loadMdmConfig();
      expect(loaded).not.toBeNull();
      expect(loaded!.orgClientId).toBe('org-home');
    });

    it('should fall back to os.homedir() for path resolution', () => {
      delete process.env['AGENSHIELD_USER_HOME'];
      delete process.env['HOME'];
      const result = loadMdmConfig();
      expect(result).toBeNull();
    });
  });

  describe('hasMdmConfig', () => {
    it('should return false when no config', () => {
      expect(hasMdmConfig()).toBe(false);
    });

    it('should return true when config exists', () => {
      saveMdmConfig({
        orgClientId: 'org-1',
        cloudUrl: 'https://cloud.test',
        createdAt: '2025-01-01T00:00:00.000Z',
      });
      expect(hasMdmConfig()).toBe(true);
    });
  });
});
