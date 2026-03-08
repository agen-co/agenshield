/**
 * Executable Watcher
 *
 * Monitors package-manager binary directories for newly installed executables.
 * When a new binary is detected (e.g. via pip, npm, brew), creates a symlink
 * in {agentHome}/bin/ pointing to the generic-wrapper for policy enforcement.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { exec } from 'node:child_process';
import { PROXIED_COMMANDS, BASIC_SYSTEM_COMMANDS } from '@agenshield/sandbox';
import { emitEvent } from '../events/emitter';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ExecutableWatcherConfig {
  agentHome: string;
  agentUsername: string;
  hostHome: string;
  pollIntervalMs?: number; // default 30000
}

interface ExecManifest {
  version: string;
  entries: Record<string, ExecManifestEntry>;
}

interface ExecManifestEntry {
  originalPath: string;
  sourceType: 'pip' | 'homebrew' | 'npm';
  wrappedAt: string;
}

type SourceType = 'pip' | 'homebrew' | 'npm';

// ─── Protected commands (never auto-wrap) ───────────────────────────────────

const PROTECTED_COMMANDS = new Set([
  ...PROXIED_COMMANDS,
  ...BASIC_SYSTEM_COMMANDS,
  'node',
  'python',
  'python3',
  'shield-client',
  'generic-wrapper',
]);

/** Characters allowed in binary names (prevent injection) */
const SAFE_NAME_RE = /^[a-zA-Z0-9_.\-]+$/;

// ─── Module state ───────────────────────────────────────────────────────────

let config: ExecutableWatcherConfig | null = null;
let watchers: fs.FSWatcher[] = [];
let pollingInterval: NodeJS.Timeout | null = null;
let debounceTimers: Map<string, NodeJS.Timeout> = new Map();

// ─── Manifest I/O ───────────────────────────────────────────────────────────

function getManifestPath(agentHome: string): string {
  return path.join(agentHome, '.agenshield', 'exec-manifest.json');
}

function loadManifest(agentHome: string): ExecManifest {
  try {
    const raw = fs.readFileSync(getManifestPath(agentHome), 'utf-8');
    return JSON.parse(raw) as ExecManifest;
  } catch {
    return { version: '1.0.0', entries: {} };
  }
}

function saveManifest(agentHome: string, manifest: ExecManifest): void {
  const manifestPath = getManifestPath(agentHome);
  const dir = path.dirname(manifestPath);
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  } catch {
    // Best-effort — manifest is advisory
  }
}

// ─── Brew manifest integration ──────────────────────────────────────────────

function loadBrewManifestBinaries(agentHome: string): Set<string> {
  try {
    const brewManifestPath = path.join(agentHome, '.agenshield', 'brew-manifest.json');
    const raw = fs.readFileSync(brewManifestPath, 'utf-8');
    const manifest = JSON.parse(raw) as { binaries?: Record<string, unknown> };
    return new Set(Object.keys(manifest.binaries ?? {}));
  } catch {
    return new Set();
  }
}

// ─── Directory resolution ───────────────────────────────────────────────────

interface WatchedDir {
  path: string;
  sourceType: SourceType;
}

/**
 * Resolve watched directories from agentHome.
 * Re-discovers NVM version dirs on each call to catch newly installed node versions.
 */
function resolveWatchedDirs(agentHome: string): WatchedDir[] {
  const dirs: WatchedDir[] = [];

  // pip: ~/.local/bin
  const pipDir = path.join(agentHome, '.local', 'bin');
  dirs.push({ path: pipDir, sourceType: 'pip' });

  // homebrew: ~/homebrew/bin
  const brewDir = path.join(agentHome, 'homebrew', 'bin');
  dirs.push({ path: brewDir, sourceType: 'homebrew' });

  // npm (NVM): ~/.nvm/versions/node/v*/bin
  const nvmBase = path.join(agentHome, '.nvm', 'versions', 'node');
  try {
    if (fs.existsSync(nvmBase)) {
      const versions = fs.readdirSync(nvmBase);
      for (const v of versions) {
        const binDir = path.join(nvmBase, v, 'bin');
        try {
          if (fs.existsSync(binDir)) {
            dirs.push({ path: binDir, sourceType: 'npm' });
          }
        } catch { /* skip unreadable */ }
      }
    }
  } catch { /* nvm not installed */ }

  return dirs;
}

// ─── Core scan logic ────────────────────────────────────────────────────────

function scanExecutables(): void {
  if (!config) return;

  const { agentHome, hostHome } = config;
  const agentBinDir = path.join(agentHome, 'bin');
  const genericWrapperPath = path.join(hostHome, '.agenshield', 'bin', 'generic-wrapper');

  // Get existing entries in agentBinDir
  let existingFiles: Set<string>;
  try {
    existingFiles = new Set(fs.readdirSync(agentBinDir));
  } catch {
    existingFiles = new Set();
  }

  // Load brew manifest to skip brew-managed binaries
  const brewBinaries = loadBrewManifestBinaries(agentHome);

  // Load exec manifest
  const manifest = loadManifest(agentHome);
  let manifestChanged = false;

  const watchedDirs = resolveWatchedDirs(agentHome);
  let detected = 0;
  let wrapped = 0;
  let skipped = 0;
  const scannedPaths: string[] = [];

  for (const watchedDir of watchedDirs) {
    if (!fs.existsSync(watchedDir.path)) continue;
    scannedPaths.push(watchedDir.path);

    let entries: string[];
    try {
      entries = fs.readdirSync(watchedDir.path);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.startsWith('.') || !SAFE_NAME_RE.test(entry)) continue;

      // Check if it's executable
      const fullPath = path.join(watchedDir.path, entry);
      try {
        const stat = fs.statSync(fullPath);
        if (!stat.isFile() && !fs.lstatSync(fullPath).isSymbolicLink()) continue;
        if ((stat.mode & 0o111) === 0) continue;
      } catch {
        continue;
      }

      detected++;

      emitEvent('executables:detected', {
        name: entry,
        directory: watchedDir.path,
        sourceType: watchedDir.sourceType,
      });

      // Skip if already in agentBinDir
      if (existingFiles.has(entry)) {
        skipped++;
        emitEvent('executables:skipped', { name: entry, reason: 'already_exists' });
        continue;
      }

      // Skip protected commands
      if (PROTECTED_COMMANDS.has(entry)) {
        skipped++;
        emitEvent('executables:skipped', { name: entry, reason: 'protected' });
        continue;
      }

      // Skip brew-managed binaries
      if (brewBinaries.has(entry)) {
        skipped++;
        emitEvent('executables:skipped', { name: entry, reason: 'already_exists' });
        continue;
      }

      // Create symlink to generic-wrapper
      const symlinkPath = path.join(agentBinDir, entry);
      let symlinkCreated = false;

      try {
        fs.symlinkSync(genericWrapperPath, symlinkPath);
        symlinkCreated = true;
      } catch {
        // Fallback to ln -sf via exec
        try {
          exec(`ln -sf "${genericWrapperPath}" "${symlinkPath}"`);
          symlinkCreated = true;
        } catch {
          // Give up
        }
      }

      if (symlinkCreated) {
        wrapped++;
        existingFiles.add(entry);

        // Record in manifest
        manifest.entries[entry] = {
          originalPath: fullPath,
          sourceType: watchedDir.sourceType,
          wrappedAt: new Date().toISOString(),
        };
        manifestChanged = true;

        emitEvent('executables:wrapped', {
          name: entry,
          symlinkPath,
          originalPath: fullPath,
          sourceType: watchedDir.sourceType,
        });
      } else {
        skipped++;
        emitEvent('executables:skipped', { name: entry, reason: 'write_failed' });
      }
    }
  }

  if (manifestChanged) {
    saveManifest(agentHome, manifest);
  }

  emitEvent('executables:scan_complete', {
    detected,
    wrapped,
    skipped,
    directories: scannedPaths,
  });
}

// ─── FS event handling ──────────────────────────────────────────────────────

const DEBOUNCE_MS = 500;

function handleFsEvent(_eventType: string, filename: string | null): void {
  if (!filename) return;

  const existing = debounceTimers.get(filename);
  if (existing) {
    clearTimeout(existing);
  }

  debounceTimers.set(
    filename,
    setTimeout(() => {
      debounceTimers.delete(filename);
      scanExecutables();
    }, DEBOUNCE_MS),
  );
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Start the executable watcher.
 * Monitors package-manager bin directories for new executables.
 */
export function startExecutableWatcher(cfg: ExecutableWatcherConfig): void {
  if (pollingInterval) return; // Already running

  config = cfg;
  const pollMs = cfg.pollIntervalMs ?? 30000;

  // Initial scan
  scanExecutables();

  // Set up fs.watch on each existing directory
  const watchedDirs = resolveWatchedDirs(cfg.agentHome);
  for (const dir of watchedDirs) {
    if (!fs.existsSync(dir.path)) continue;
    try {
      const w = fs.watch(dir.path, { persistent: false }, handleFsEvent);
      w.on('error', () => {
        // Silently ignore — polling will cover
      });
      watchers.push(w);
    } catch {
      // fs.watch not available for this dir
    }
  }

  // Polling fallback (catches newly created dirs, new NVM versions)
  pollingInterval = setInterval(scanExecutables, pollMs);

  console.log(`[ExecutableWatcher] Started (poll: ${pollMs}ms, dirs: ${watchedDirs.length})`);
}

/**
 * Stop the executable watcher and clean up resources.
 */
export function stopExecutableWatcher(): void {
  for (const w of watchers) {
    try { w.close(); } catch { /* ignore */ }
  }
  watchers = [];

  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }

  for (const timer of debounceTimers.values()) {
    clearTimeout(timer);
  }
  debounceTimers.clear();

  config = null;
  console.log('[ExecutableWatcher] Stopped');
}

/**
 * Trigger an immediate rescan of all watched directories.
 */
export function triggerExecutableScan(): void {
  scanExecutables();
}
