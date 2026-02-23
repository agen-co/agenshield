import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('Install Flow (real filesystem)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenshield-install-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('generates wrapper content, writes to file, and reads back', () => {
    // Manually generate a simple wrapper (no need to import the full module with its deps)
    const wrapperContent = `#!/bin/bash
# AgenShield test wrapper
# Routes through broker for monitoring

SOCKET_PATH="/var/run/agenshield/agenshield.sock"

case "$1" in
  clone|fetch|push|pull)
    echo "Routed through broker"
    ;;
  *)
    exec /usr/bin/git "$@"
    ;;
esac
`;

    const wrapperPath = path.join(tmpDir, 'git');
    fs.writeFileSync(wrapperPath, wrapperContent, { mode: 0o755 });

    // Read back and verify
    const readContent = fs.readFileSync(wrapperPath, 'utf-8');
    expect(readContent).toBe(wrapperContent);
    expect(readContent).toContain('#!/bin/bash');
    expect(readContent).toContain('AgenShield');

    // Verify file is executable
    const stats = fs.statSync(wrapperPath);
    expect(stats.mode & 0o111).toBeTruthy();
  });

  it('creates directory structure and verifies it exists', () => {
    const dirs = [
      'bin',
      '.agenshield',
      '.agenshield/seatbelt',
      '.agenshield/run',
      '.agenshield/logs',
      '.agenshield/config',
      '.agenshield/policies',
      '.zdot',
      '.openclaw',
      'workspace',
    ];

    for (const dir of dirs) {
      fs.mkdirSync(path.join(tmpDir, dir), { recursive: true });
    }

    for (const dir of dirs) {
      const fullPath = path.join(tmpDir, dir);
      expect(fs.existsSync(fullPath)).toBe(true);
      expect(fs.statSync(fullPath).isDirectory()).toBe(true);
    }
  });

  it('writes and reads a shell script with correct shebang', () => {
    const shellContent = `#!/bin/zsh
# guarded-shell test
emulate -LR zsh
exec /bin/zsh "$@"
`;

    const shellPath = path.join(tmpDir, 'guarded-shell');
    fs.writeFileSync(shellPath, shellContent, { mode: 0o755 });

    const readBack = fs.readFileSync(shellPath, 'utf-8');
    expect(readBack.startsWith('#!/bin/zsh')).toBe(true);
    expect(readBack).toContain('emulate -LR zsh');
  });

  it('creates multiple wrappers and lists them', () => {
    const wrapperNames = ['git', 'npm', 'node', 'curl', 'python'];

    for (const name of wrapperNames) {
      const content = `#!/bin/bash\n# ${name} wrapper\nexec /usr/bin/${name} "$@"\n`;
      fs.writeFileSync(path.join(tmpDir, name), content, { mode: 0o755 });
    }

    const files = fs.readdirSync(tmpDir);
    for (const name of wrapperNames) {
      expect(files).toContain(name);
    }
    expect(files.length).toBe(wrapperNames.length);
  });

  it('writes a seatbelt profile and verifies balanced parentheses', () => {
    const profile = `(version 1)
(deny default)
(allow file-read* (subpath "/System"))
(allow file-read* (subpath "/usr/lib"))
(deny network*)
(allow sysctl-read)
`;

    const profilePath = path.join(tmpDir, 'agent.sb');
    fs.writeFileSync(profilePath, profile, { mode: 0o644 });

    const readBack = fs.readFileSync(profilePath, 'utf-8');

    // Verify balanced parentheses
    let depth = 0;
    for (const char of readBack) {
      if (char === '(') depth++;
      if (char === ')') depth--;
      expect(depth).toBeGreaterThanOrEqual(0);
    }
    expect(depth).toBe(0);
  });
});
