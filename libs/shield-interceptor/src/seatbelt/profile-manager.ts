/**
 * Seatbelt Profile Manager
 *
 * Generates macOS seatbelt (sandbox-exec) SBPL profiles from SandboxConfig,
 * writes them to disk with content-hash naming for caching, and manages cleanup.
 *
 * Uses captured-original fs functions to avoid interception loops.
 */

import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import type { SandboxConfig } from '@agenshield/ipc';
import { debugLog } from '../debug-log.js';

// Capture original fs functions at module load time (before any interceptor patches).
const _mkdirSync = fs.mkdirSync.bind(fs);
const _writeFileSync = fs.writeFileSync.bind(fs);
const _existsSync = fs.existsSync.bind(fs);
const _readFileSync = fs.readFileSync.bind(fs);
const _readdirSync = fs.readdirSync.bind(fs);
const _statSync = fs.statSync.bind(fs);
const _unlinkSync = fs.unlinkSync.bind(fs);

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
      debugLog(`profile-manager: writing new profile ${profilePath} (${content.length} bytes)`);
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

    // Denied paths
    if (sandbox.deniedPaths.length > 0) {
      lines.push(';; Denied paths');
      for (const p of sandbox.deniedPaths) {
        lines.push(`(deny file-read* file-write* (subpath "${this.escapeSbpl(p)}"))`);
      }
      lines.push('');
    }

    // Binary execution
    lines.push(';; Binary execution');
    lines.push('(allow process-exec');
    lines.push('  (literal "/bin/sh")');
    lines.push('  (literal "/bin/bash")');
    lines.push('  (literal "/usr/bin/env")');
    lines.push('  (literal "/usr/bin/sandbox-exec")');

    if (sandbox.allowedBinaries.length > 0) {
      for (const bin of sandbox.allowedBinaries) {
        if (bin.endsWith('/')) {
          // Directory: allow subpath
          lines.push(`  (subpath "${this.escapeSbpl(bin)}")`);
        } else {
          lines.push(`  (literal "${this.escapeSbpl(bin)}")`);
        }
      }
    }
    lines.push(')');
    lines.push('');

    // Denied binaries
    if (sandbox.deniedBinaries.length > 0) {
      lines.push(';; Denied binaries');
      for (const bin of sandbox.deniedBinaries) {
        lines.push(`(deny process-exec (literal "${this.escapeSbpl(bin)}"))`);
      }
      lines.push('');
    }

    // Network rules
    lines.push(';; Network');
    if (sandbox.networkAllowed) {
      if (sandbox.allowedHosts.length > 0 || sandbox.allowedPorts.length > 0) {
        // Specific hosts/ports allowed
        lines.push(';; Allow specific network targets');
        for (const host of sandbox.allowedHosts) {
          lines.push(`(allow network-outbound (remote tcp "${this.escapeSbpl(host)}:*"))`);
        }
        for (const port of sandbox.allowedPorts) {
          lines.push(`(allow network-outbound (remote tcp "*:${port}"))`);
        }
        // DNS resolution — skip if localhost-only (proxy handles DNS externally)
        const isLocalhostOnly = sandbox.allowedHosts.length > 0 &&
          sandbox.allowedHosts.every(h => h === 'localhost' || h === '127.0.0.1');
        if (!isLocalhostOnly) {
          lines.push('(allow network-outbound (remote udp "*:53") (remote tcp "*:53"))');
        }
      } else {
        // Full network access
        lines.push('(allow network*)');
      }
    } else {
      lines.push('(deny network*)');
    }
    lines.push('');

    // Unix socket for broker communication (always allowed).
    // Also allow file access to the socket path itself.
    lines.push(
      ';; Broker / local unix sockets',
      '(allow network-outbound (remote unix))',
      '(allow network-inbound (local unix))',
      '(allow file-read* file-write*',
      '  (subpath "/var/run/agenshield")',
      '  (subpath "/private/var/run/agenshield"))',
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

    // Mach IPC lookups — many commands need various Mach services to function.
    // Rather than whitelisting individual services (which is fragile across macOS versions),
    // allow all mach-lookup. The security boundary is network + filesystem, not IPC.
    lines.push(
      ';; Mach IPC',
      '(allow mach-lookup)',
      '',
    );

    return lines.join('\n');
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
            debugLog(`profile-manager: cleaned up stale profile ${filePath}`);
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
      _mkdirSync(this.profileDir, { recursive: true, mode: 0o755 });
    }
    this.ensuredDir = true;
  }
}
