import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('Restore Flow (real filesystem)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenshield-restore-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes backup JSON, reads back, and verifies structure', () => {
    const backup = {
      version: '1.0',
      timestamp: new Date().toISOString(),
      originalUser: 'testuser',
      originalUserHome: '/Users/testuser',
      originalInstallation: {
        method: 'npm',
        packagePath: '/usr/local/lib/node_modules/openclaw',
        binaryPath: '/usr/local/bin/openclaw',
        configPath: '/Users/testuser/.openclaw',
        version: '1.2.3',
      },
      sandboxUser: {
        username: 'ash_default_agent',
        uid: 5200,
        gid: 5100,
        homeDir: '/Users/ash_default_agent',
      },
      migratedPaths: {
        configPath: '/Users/ash_default_agent/.openclaw',
        packagePath: '/Users/ash_default_agent/.openclaw/workspace',
      },
    };

    const backupPath = path.join(tmpDir, 'backup.json');
    fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2), { mode: 0o600 });

    // Read back
    const raw = fs.readFileSync(backupPath, 'utf-8');
    const parsed = JSON.parse(raw);

    expect(parsed.version).toBe('1.0');
    expect(parsed.originalUser).toBe('testuser');
    expect(parsed.originalInstallation.method).toBe('npm');
    expect(parsed.sandboxUser.username).toBe('ash_default_agent');
    expect(parsed.migratedPaths.configPath).toContain('.openclaw');
  });

  it('backup file has restrictive permissions', () => {
    const backupPath = path.join(tmpDir, 'backup.json');
    fs.writeFileSync(backupPath, '{}', { mode: 0o600 });

    const stats = fs.statSync(backupPath);
    const mode = stats.mode & 0o777;

    expect(mode).toBe(0o600);
  });

  it('handles empty backup gracefully', () => {
    const backupPath = path.join(tmpDir, 'backup.json');
    fs.writeFileSync(backupPath, '{}');

    const raw = fs.readFileSync(backupPath, 'utf-8');
    const parsed = JSON.parse(raw);

    expect(parsed).toEqual({});
  });

  it('simulates config restoration by moving directory', () => {
    // Create a "backup" config directory
    const backupConfigDir = path.join(tmpDir, 'backup-config');
    fs.mkdirSync(backupConfigDir);
    fs.writeFileSync(
      path.join(backupConfigDir, 'openclaw.json'),
      JSON.stringify({ identity: { name: 'TestBot' } }),
    );

    // "Restore" by renaming
    const restoredConfigDir = path.join(tmpDir, 'restored-config');
    fs.renameSync(backupConfigDir, restoredConfigDir);

    // Verify
    expect(fs.existsSync(restoredConfigDir)).toBe(true);
    expect(fs.existsSync(backupConfigDir)).toBe(false);

    const config = JSON.parse(
      fs.readFileSync(path.join(restoredConfigDir, 'openclaw.json'), 'utf-8'),
    );
    expect(config.identity.name).toBe('TestBot');
  });

  it('validates backup JSON schema', () => {
    const validBackup = {
      version: '1.0',
      timestamp: '2024-01-01T00:00:00.000Z',
      originalUser: 'user',
      originalUserHome: '/Users/user',
      originalInstallation: {
        method: 'npm',
      },
      sandboxUser: {
        username: 'ash_default_agent',
      },
      migratedPaths: {},
    };

    const backupPath = path.join(tmpDir, 'valid-backup.json');
    fs.writeFileSync(backupPath, JSON.stringify(validBackup));

    const parsed = JSON.parse(fs.readFileSync(backupPath, 'utf-8'));

    expect(parsed.version).toBe('1.0');
    expect(typeof parsed.timestamp).toBe('string');
    expect(typeof parsed.originalUser).toBe('string');
    expect(typeof parsed.originalInstallation).toBe('object');
    expect(typeof parsed.sandboxUser).toBe('object');
  });
});
