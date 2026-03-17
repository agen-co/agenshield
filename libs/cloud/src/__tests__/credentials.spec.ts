/**
 * Tests for cloud credential storage
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CLOUD_CONFIG } from '../config';
import {
  saveCloudCredentials,
  loadCloudCredentials,
  isCloudEnrolled,
} from '../credentials';

describe('Cloud credentials', () => {
  let tmpDir: string;
  const origEnv = { ...process.env };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-creds-test-'));
    process.env['AGENSHIELD_USER_HOME'] = tmpDir;
  });

  afterEach(() => {
    process.env = { ...origEnv };
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should save and load credentials', () => {
    saveCloudCredentials('agent-1', 'pk-data', 'https://cloud.test', 'TestCo');
    const creds = loadCloudCredentials();
    expect(creds).not.toBeNull();
    expect(creds!.agentId).toBe('agent-1');
    expect(creds!.privateKey).toBe('pk-data');
    expect(creds!.cloudUrl).toBe('https://cloud.test');
    expect(creds!.companyName).toBe('TestCo');
    expect(creds!.registeredAt).toBeDefined();
  });

  it('should return null when no credentials file', () => {
    expect(loadCloudCredentials()).toBeNull();
  });

  it('should return null for invalid JSON', () => {
    const credPath = CLOUD_CONFIG.credentialsPath;
    fs.mkdirSync(path.dirname(credPath), { recursive: true });
    fs.writeFileSync(credPath, 'not json');
    expect(loadCloudCredentials()).toBeNull();
  });

  it('should return null when missing required fields', () => {
    const credPath = CLOUD_CONFIG.credentialsPath;
    fs.mkdirSync(path.dirname(credPath), { recursive: true });
    fs.writeFileSync(credPath, JSON.stringify({ agentId: '', privateKey: '' }));
    expect(loadCloudCredentials()).toBeNull();
  });

  describe('isCloudEnrolled', () => {
    it('should return false when not enrolled', () => {
      expect(isCloudEnrolled()).toBe(false);
    });

    it('should return true when enrolled', () => {
      saveCloudCredentials('a1', 'pk', 'url', 'co');
      expect(isCloudEnrolled()).toBe(true);
    });
  });
});
