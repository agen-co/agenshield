/**
 * Binary Scanner
 *
 * Scans system directories, PATH, npm/yarn globals, agent bins, and workspace
 * bins to discover all executables, classifying them by source, execution
 * context, and protection status.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import type {
  BinarySourceKind,
  ExecutionContext,
  ProtectionKind,
  DiscoveredBinary,
  BinaryDirectory,
  DiscoveryOptions,
} from '@agenshield/ipc';
import { PROXIED_COMMANDS } from '../shield-exec';
import { WRAPPER_DEFINITIONS } from '../wrappers';

/** Standard system binary directories */
const SYSTEM_BIN_DIRS = [
  '/usr/bin',
  '/usr/sbin',
  '/usr/local/bin',
  '/usr/local/sbin',
  '/opt/homebrew/bin',
  '/opt/homebrew/sbin',
];

/** AgenShield system bin directory */
const AGENSHIELD_SYSTEM_BIN = '/opt/agenshield/bin';

/** Allowed-commands config path */
const ALLOWED_COMMANDS_PATH = '/opt/agenshield/config/allowed-commands.json';

/** Category map for binary classification */
const CATEGORY_MAP: Record<string, DiscoveredBinary['category']> = {
  // Network
  curl: 'network', wget: 'network', ssh: 'network', scp: 'network',
  rsync: 'network', nc: 'network', telnet: 'network', ftp: 'network',
  sftp: 'network', nslookup: 'network', dig: 'network', host: 'network',
  ping: 'network', traceroute: 'network', netstat: 'network',
  // Package managers
  npm: 'package-manager', npx: 'package-manager', pip: 'package-manager',
  pip3: 'package-manager', brew: 'package-manager', yarn: 'package-manager',
  pnpm: 'package-manager', gem: 'package-manager', cargo: 'package-manager',
  // Shell
  bash: 'shell', zsh: 'shell', sh: 'shell', fish: 'shell',
  dash: 'shell', ksh: 'shell', csh: 'shell', tcsh: 'shell',
  // System
  ls: 'system', cp: 'system', mv: 'system', rm: 'system',
  mkdir: 'system', chmod: 'system', chown: 'system', chgrp: 'system',
  cat: 'system', echo: 'system', touch: 'system', ln: 'system',
  find: 'system', grep: 'system', sed: 'system', awk: 'system',
  ps: 'system', kill: 'system', top: 'system', df: 'system',
  du: 'system', mount: 'system', umount: 'system',
  // Language runtimes
  node: 'language-runtime', python: 'language-runtime', python3: 'language-runtime',
  ruby: 'language-runtime', perl: 'language-runtime', java: 'language-runtime',
  go: 'language-runtime', rustc: 'language-runtime', deno: 'language-runtime',
  bun: 'language-runtime',
};

/** Wrapper names set (derived from WRAPPER_DEFINITIONS keys) */
const WRAPPER_NAMES = new Set(Object.keys(WRAPPER_DEFINITIONS));

/** Cached allowed command names */
let allowedCommandsCache: Set<string> | null = null;

function loadAllowedCommands(): Set<string> {
  if (allowedCommandsCache) return allowedCommandsCache;
  try {
    if (fs.existsSync(ALLOWED_COMMANDS_PATH)) {
      const content = fs.readFileSync(ALLOWED_COMMANDS_PATH, 'utf-8');
      const config = JSON.parse(content) as { commands?: { name: string }[] };
      allowedCommandsCache = new Set((config.commands ?? []).map((c) => c.name));
      return allowedCommandsCache;
    }
  } catch {
    // Ignore
  }
  allowedCommandsCache = new Set();
  return allowedCommandsCache;
}

/**
 * Detect the npm global bin directory
 */
export function detectNpmGlobalBin(): string | null {
  try {
    const prefix = execSync('npm prefix -g 2>/dev/null', {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
    if (prefix) {
      const bin = path.join(prefix, 'bin');
      if (fs.existsSync(bin)) return bin;
    }
  } catch {
    // npm not available or timed out
  }
  return null;
}

/**
 * Detect the yarn global bin directory
 */
export function detectYarnGlobalBin(): string | null {
  try {
    const bin = execSync('yarn global bin 2>/dev/null', {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
    if (bin && fs.existsSync(bin)) return bin;
  } catch {
    // yarn not available or timed out
  }
  return null;
}

/**
 * Classify a directory into a BinarySourceKind
 */
export function classifyDirectory(
  dirPath: string,
  npmGlobalBin: string | null,
  yarnGlobalBin: string | null,
  options: DiscoveryOptions,
): BinarySourceKind {
  const resolved = path.resolve(dirPath);

  // Agent home bin
  if (options.agentHome) {
    const agentBin = path.join(options.agentHome, 'bin');
    if (resolved === path.resolve(agentBin)) return 'agent-bin';
  }

  // Workspace bin (node_modules/.bin)
  if (options.workspaceDir && resolved.startsWith(path.resolve(options.workspaceDir))) {
    return 'workspace-bin';
  }

  // npm global
  if (npmGlobalBin && resolved === path.resolve(npmGlobalBin)) return 'npm-global';

  // yarn global
  if (yarnGlobalBin && resolved === path.resolve(yarnGlobalBin)) return 'yarn-global';

  // Homebrew
  if (resolved.startsWith('/opt/homebrew/') || resolved === '/usr/local/bin' || resolved === '/usr/local/sbin') {
    return 'homebrew';
  }

  // System dirs
  if (resolved === '/usr/bin' || resolved === '/usr/sbin') return 'system';

  // AgenShield system bin
  if (resolved === AGENSHIELD_SYSTEM_BIN) return 'system';

  return 'path-other';
}

/**
 * Determine execution contexts for a directory
 */
export function getContextsForDir(
  dirPath: string,
  sourceKind: BinarySourceKind,
  _options: DiscoveryOptions,
): ExecutionContext[] {
  switch (sourceKind) {
    case 'workspace-bin':
      return ['workspace'];
    case 'agent-bin':
      return ['user'];
    case 'system':
    case 'homebrew':
    case 'npm-global':
    case 'yarn-global':
    case 'path-other':
    default:
      return ['root'];
  }
}

/**
 * Determine the protection status of a binary by name
 */
export function getProtection(name: string): ProtectionKind {
  if ((PROXIED_COMMANDS as readonly string[]).includes(name)) return 'proxied';
  if (WRAPPER_NAMES.has(name)) return 'wrapped';
  if (loadAllowedCommands().has(name)) return 'allowed';
  return 'unprotected';
}

/**
 * Check if a file is a symlink pointing to shield-exec
 */
export function isShieldExecLink(filePath: string): boolean {
  try {
    const target = fs.readlinkSync(filePath);
    return target.endsWith('shield-exec') || target.endsWith('/shield-exec');
  } catch {
    return false;
  }
}

/**
 * Categorize a binary by name
 */
export function categorize(name: string): DiscoveredBinary['category'] {
  return CATEGORY_MAP[name] || 'other';
}

/**
 * Scan all binary directories and return discovered binaries and directory metadata
 */
export function scanBinaries(options: DiscoveryOptions): {
  binaries: DiscoveredBinary[];
  directories: BinaryDirectory[];
} {
  // Reset allowed commands cache for fresh scan
  allowedCommandsCache = null;

  // Detect package manager global bins
  const npmGlobalBin = detectNpmGlobalBin();
  const yarnGlobalBin = detectYarnGlobalBin();

  // Build directory list
  const pathDirs = (process.env['PATH'] ?? '').split(':').filter(Boolean);
  const candidateDirs = [
    ...SYSTEM_BIN_DIRS,
    AGENSHIELD_SYSTEM_BIN,
    ...pathDirs,
  ];

  if (npmGlobalBin) candidateDirs.push(npmGlobalBin);
  if (yarnGlobalBin) candidateDirs.push(yarnGlobalBin);

  if (options.agentHome) {
    candidateDirs.push(path.join(options.agentHome, 'bin'));
  }

  if (options.workspaceDir) {
    candidateDirs.push(path.join(options.workspaceDir, 'node_modules', '.bin'));
  }

  if (options.extraDirs) {
    candidateDirs.push(...options.extraDirs);
  }

  // Deduplicate directories
  const seenDirs = new Set<string>();
  const uniqueDirs: string[] = [];
  for (const dir of candidateDirs) {
    const resolved = path.resolve(dir);
    if (!seenDirs.has(resolved)) {
      seenDirs.add(resolved);
      uniqueDirs.push(resolved);
    }
  }

  const seenBinaries = new Map<string, DiscoveredBinary>();
  const directories: BinaryDirectory[] = [];

  for (const dir of uniqueDirs) {
    try {
      if (!fs.existsSync(dir)) continue;

      const sourceKind = classifyDirectory(dir, npmGlobalBin, yarnGlobalBin, options);
      const contexts = getContextsForDir(dir, sourceKind, options);
      let count = 0;

      const entries = fs.readdirSync(dir);
      for (const entry of entries) {
        const fullPath = path.join(dir, entry);
        try {
          const stat = fs.statSync(fullPath);
          if (!stat.isFile() && !fs.lstatSync(fullPath).isSymbolicLink()) continue;
          if ((stat.mode & 0o111) === 0) continue;

          count++;

          if (seenBinaries.has(entry)) {
            // Merge contexts for duplicate binary names
            const existing = seenBinaries.get(entry)!;
            for (const ctx of contexts) {
              if (!existing.contexts.includes(ctx)) {
                existing.contexts.push(ctx);
              }
            }
            continue;
          }

          seenBinaries.set(entry, {
            name: entry,
            path: fullPath,
            dir,
            sourceKind,
            contexts: [...contexts],
            protection: getProtection(entry),
            category: categorize(entry),
            isShieldExecSymlink: isShieldExecLink(fullPath),
          });
        } catch {
          // Skip entries we can't stat
        }
      }

      if (count > 0) {
        directories.push({ path: dir, sourceKind, contexts, count });
      }
    } catch {
      // Skip directories we can't read
    }
  }

  const binaries = Array.from(seenBinaries.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  return { binaries, directories };
}
