/**
 * Seatbelt Profile Manager
 *
 * Generates macOS seatbelt (sandbox-exec) SBPL profiles from SandboxConfig,
 * writes them to disk with content-hash naming for caching, and manages cleanup.
 *
 * Uses captured-original fs functions to avoid interception loops.
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import type { SandboxConfig } from '@agenshield/ipc';

// Capture original fs functions at module load time (before any interceptor patches).
const _mkdirSync = fs.mkdirSync.bind(fs);
const _writeFileSync = fs.writeFileSync.bind(fs);
const _existsSync = fs.existsSync.bind(fs);
const _readFileSync = fs.readFileSync.bind(fs);
const _readdirSync = fs.readdirSync.bind(fs);
const _statSync = fs.statSync.bind(fs);
const _unlinkSync = fs.unlinkSync.bind(fs);
const _chmodSync = fs.chmodSync.bind(fs);

// Capture async fs functions at module load time (before any interceptor patches).
const _access = fsp.access.bind(fsp);
const _writeFileAsync = fsp.writeFile.bind(fsp);
const _mkdirAsync = fsp.mkdir.bind(fsp);
const _readdirAsync = fsp.readdir.bind(fsp);
const _statAsync = fsp.stat.bind(fsp);
const _unlinkAsync = fsp.unlink.bind(fsp);
const _chmodAsync = fsp.chmod.bind(fsp);

export class ProfileManager {
  private profileDir: string;
  private ensuredDir = false;

  constructor(profileDir: string) {
    this.profileDir = profileDir;
  }

  /**
   * Get or create a profile file on disk. Returns the absolute path.
   * Uses content-hash naming so identical configs reuse the same file.
   */
  getOrCreateProfile(content: string): string {
    this.ensureDir();

    const hash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
    const profilePath = path.join(this.profileDir, `sb-${hash}.sb`);

    if (!_existsSync(profilePath)) {
      _writeFileSync(profilePath, content, { mode: 0o644 });
    }

    return profilePath;
  }

  /**
   * Generate an SBPL profile from a SandboxConfig.
   */
  generateProfile(sandbox: SandboxConfig): string {
    // If pre-generated content is provided, use it directly
    if (sandbox.profileContent) {
      return sandbox.profileContent;
    }

    const lines: string[] = [
      ';; AgenShield dynamic seatbelt profile',
      `;; Generated: ${new Date().toISOString()}`,
      '(version 1)',
      '(deny default)',
      '',
    ];

    // Filesystem: allow all reads by default.
    // macOS APFS firmlinks between System and Data volumes make subpath-based
    // restrictions unreliable (processes SIGABRT when accessing firmlinked paths).
    // The security boundary is network isolation + binary execution control.
    lines.push(
      ';; Filesystem: reads allowed, writes restricted',
      '(allow file-read*)',
      '',
    );

    // Write access: temp dirs + explicitly allowed paths
    const writePaths = ['/tmp', '/private/tmp', '/var/folders'];
    if (sandbox.allowedWritePaths.length > 0) {
      writePaths.push(...sandbox.allowedWritePaths);
    }
    lines.push('(allow file-write*');
    for (const p of writePaths) {
      lines.push(`  (subpath "${this.escapeSbpl(p)}")`);
    }
    lines.push(')');
    lines.push('');

    // Device files: /dev/null etc. are single files, not directories — use literal
    lines.push('(allow file-write*');
    lines.push('  (literal "/dev/null")');
    lines.push('  (literal "/dev/zero")');
    lines.push('  (literal "/dev/random")');
    lines.push('  (literal "/dev/urandom")');
    lines.push(')');
    lines.push('');

    // Denied paths
    if (sandbox.deniedPaths.length > 0) {
      lines.push(';; Denied paths');
      for (const p of sandbox.deniedPaths) {
        lines.push(`(deny file-read* file-write* (subpath "${this.escapeSbpl(p)}"))`);
      }
      lines.push('');
    }

    // Read exceptions within denied paths (more specific subpath overrides deny)
    if (sandbox.allowedReadPaths.length > 0) {
      lines.push(';; Allowed read paths (exceptions to denied paths)');
      for (const p of sandbox.allowedReadPaths) {
        lines.push(`(allow file-read* (subpath "${this.escapeSbpl(p)}"))`);
      }
      lines.push('');
    }

    // Binary execution — only shell necessities + agent-local paths.
    // System binary dirs (/usr/bin, /bin, etc.) are NOT allowed as subpaths.
    // Specific system binaries are added as literals via allowedBinaries.
    lines.push(';; Binary execution (restricted to shell necessities + agent paths)');
    lines.push('(allow process-exec');

    // Shell necessities (literal — only these specific binaries, not all of /bin/)
    lines.push('  (literal "/bin/sh")');
    lines.push('  (literal "/bin/bash")');
    lines.push('  (literal "/usr/bin/env")');

    // Resolve agent-specific paths from environment
    const coveredSubpaths: string[] = [];
    const home = process.env['HOME'];
    if (home) {
      lines.push(`  (subpath "${this.escapeSbpl(home)}/bin")`);
      lines.push(`  (subpath "${this.escapeSbpl(home)}/homebrew")`);
      coveredSubpaths.push(`${home}/bin/`, `${home}/homebrew/`);
    }
    const nvmDir = process.env['NVM_DIR'] || (home ? `${home}/.nvm` : null);
    if (nvmDir) {
      lines.push(`  (subpath "${this.escapeSbpl(nvmDir)}")`);
      coveredSubpaths.push(`${nvmDir}/`);
    }

    // Additional paths from policy (e.g. node_modules, custom binaries)
    const uniqueBinaries = [...new Set(sandbox.allowedBinaries)];
    for (const bin of uniqueBinaries) {
      if (coveredSubpaths.some(dir => bin === dir || bin.startsWith(dir))) continue;
      if (bin.endsWith('/')) {
        lines.push(`  (subpath "${this.escapeSbpl(bin)}")`);
      } else {
        lines.push(`  (literal "${this.escapeSbpl(bin)}")`);
      }
    }
    lines.push(')');
    lines.push('');

    // Denied binaries (deduplicated)
    const uniqueDenied = [...new Set(sandbox.deniedBinaries)];
    if (uniqueDenied.length > 0) {
      lines.push(';; Denied binaries');
      for (const bin of uniqueDenied) {
        lines.push(`(deny process-exec (literal "${this.escapeSbpl(bin)}"))`);
      }
      lines.push('');
    }

    // Network rules
    lines.push(';; Network');
    if (sandbox.networkAllowed) {
      if (sandbox.allowedHosts.length > 0 || sandbox.allowedPorts.length > 0) {
        lines.push(';; Allow specific network targets');
        for (const host of sandbox.allowedHosts) {
          const sbplHost = (host === '127.0.0.1' || host === '::1') ? 'localhost' : host;
          lines.push(`(allow network-outbound (remote tcp "${this.escapeSbpl(sbplHost)}:*"))`);
        }
        for (const port of sandbox.allowedPorts) {
          lines.push(`(allow network-outbound (remote tcp "*:${port}"))`);
        }
        const isLocalhostOnly = sandbox.allowedHosts.length > 0 &&
          sandbox.allowedHosts.every(h => h === 'localhost' || h === '127.0.0.1' || h === '::1');
        if (!isLocalhostOnly) {
          lines.push('(allow network-outbound (remote udp "*:53") (remote tcp "*:53"))');
        }
      } else {
        lines.push('(allow network*)');
      }
    } else {
      lines.push('(deny network*)');
    }
    lines.push('');

    // Unix socket for broker communication (always allowed).
    const brokerPort = sandbox.brokerHttpPort || 5201;
    const userHome = process.env['AGENSHIELD_USER_HOME'] || process.env['HOME'] || '';
    const runDir = `${userHome}/.agenshield/run`;
    lines.push(
      ';; Broker / local unix sockets + HTTP fallback',
      '(allow network-outbound (remote unix))',
      '(allow network-inbound (local unix))',
      `(allow network-outbound (remote tcp "localhost:${brokerPort}"))`,
      '(allow file-read* file-write*',
      `  (subpath "${runDir}")`,
      `  (subpath "/private${runDir}"))`,
      '',
    );

    // Process management
    lines.push(
      ';; Process management',
      '(allow process-fork)',
      '(allow signal (target self))',
      '(allow sysctl-read)',
      '',
    );

    // Mach IPC lookups
    lines.push(
      ';; Mach IPC',
      '(allow mach-lookup)',
      '',
    );

    return lines.join('\n');
  }

  /**
   * Async version of getOrCreateProfile.
   * Returns the absolute path to the profile file.
   */
  async getOrCreateProfileAsync(content: string): Promise<string> {
    await this.ensureDirAsync();

    const hash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
    const profilePath = path.join(this.profileDir, `sb-${hash}.sb`);

    const exists = await _access(profilePath).then(() => true, () => false);
    if (!exists) {
      await _writeFileAsync(profilePath, content, { mode: 0o644 });
    }

    return profilePath;
  }

  /**
   * Remove stale profile files older than maxAgeMs.
   */
  cleanup(maxAgeMs: number): void {
    if (!_existsSync(this.profileDir)) return;

    try {
      const now = Date.now();
      const entries = _readdirSync(this.profileDir);
      for (const entry of entries) {
        if (!entry.endsWith('.sb')) continue;
        const filePath = path.join(this.profileDir, entry);
        try {
          const stat = _statSync(filePath);
          if (now - stat.mtimeMs > maxAgeMs) {
            _unlinkSync(filePath);
          }
        } catch {
          // Skip files we can't stat
        }
      }
    } catch {
      // Ignore cleanup errors
    }
  }

  /**
   * Async version of cleanup. Remove stale profile files older than maxAgeMs.
   */
  async cleanupAsync(maxAgeMs: number): Promise<void> {
    const exists = await _access(this.profileDir).then(() => true, () => false);
    if (!exists) return;

    try {
      const now = Date.now();
      const entries = await _readdirAsync(this.profileDir);
      for (const entry of entries) {
        if (!(entry as string).endsWith('.sb')) continue;
        const filePath = path.join(this.profileDir, entry as string);
        try {
          const stat = await _statAsync(filePath);
          if (now - stat.mtimeMs > maxAgeMs) {
            await _unlinkAsync(filePath);
          }
        } catch {
          // Skip files we can't stat
        }
      }
    } catch {
      // Ignore cleanup errors
    }
  }

  /**
   * Escape a string for safe inclusion in SBPL
   */
  private escapeSbpl(s: string): string {
    return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  /**
   * Ensure the profile directory exists
   */
  private ensureDir(): void {
    if (this.ensuredDir) return;
    if (!_existsSync(this.profileDir)) {
      _mkdirSync(this.profileDir, { recursive: true, mode: 0o1777 });
    } else {
      try {
        const stat = _statSync(this.profileDir);
        if ((stat.mode & 0o777) !== 0o777) {
          _chmodSync(this.profileDir, 0o1777);
        }
      } catch { /* may not own the dir */ }
    }
    this.ensuredDir = true;
  }

  /**
   * Async version of ensureDir.
   */
  private async ensureDirAsync(): Promise<void> {
    if (this.ensuredDir) return;
    const exists = await _access(this.profileDir).then(() => true, () => false);
    if (!exists) {
      await _mkdirAsync(this.profileDir, { recursive: true, mode: 0o1777 });
    } else {
      try {
        const stat = await _statAsync(this.profileDir);
        if ((stat.mode & 0o777) !== 0o777) {
          await _chmodAsync(this.profileDir, 0o1777);
        }
      } catch { /* may not own the dir */ }
    }
    this.ensuredDir = true;
  }
}
