/**
 * Tests for cloud configuration
 */

import * as path from 'node:path';
import { CLOUD_CONFIG } from '../config';

describe('CLOUD_CONFIG', () => {
  const origEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it('should return default URL when env not set', () => {
    delete process.env['AGENSHIELD_CLOUD_URL'];
    expect(CLOUD_CONFIG.url).toBe('http://localhost:9090');
  });

  it('should use env override for URL', () => {
    process.env['AGENSHIELD_CLOUD_URL'] = 'https://cloud.example.com';
    expect(CLOUD_CONFIG.url).toBe('https://cloud.example.com');
  });

  it('should resolve credentialsPath using AGENSHIELD_USER_HOME', () => {
    process.env['AGENSHIELD_USER_HOME'] = '/tmp/test-home';
    expect(CLOUD_CONFIG.credentialsPath).toBe(
      path.join('/tmp/test-home', '.agenshield', 'cloud.json'),
    );
  });

  it('should fall back to HOME for credentialsPath', () => {
    delete process.env['AGENSHIELD_USER_HOME'];
    process.env['HOME'] = '/test/home';
    expect(CLOUD_CONFIG.credentialsPath).toBe(
      path.join('/test/home', '.agenshield', 'cloud.json'),
    );
  });

  it('should fall back to os.homedir() for credentialsPath', () => {
    delete process.env['AGENSHIELD_USER_HOME'];
    delete process.env['HOME'];
    const result = CLOUD_CONFIG.credentialsPath;
    expect(result).toContain('.agenshield');
    expect(result).toContain('cloud.json');
  });
});
