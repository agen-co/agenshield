/**
 * OpenClaw Config Service
 *
 * Helpers to manage per-skill entries in $AGENT_HOME/.openclaw/openclaw.json.
 * Skills are configured under skills.entries.<skillKey> with { enabled: boolean }.
 *
 * AgenShield owns installation and secrets — openclaw.json must NOT contain
 * env variables or install preferences (preferBrew, nodeManager).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import type { PolicyConfig } from '@agenshield/ipc';

function getOpenClawConfigPath(): string {
  const agentHome = process.env['AGENSHIELD_AGENT_HOME'] || '/Users/ash_default_agent';
  return path.join(agentHome, '.openclaw', 'openclaw.json');
}

interface OpenClawConfig {
  skills?: {
    allowBundled?: string[];
    load?: { watch?: boolean; watchDebounceMs?: number; extraDirs?: string[] };
    install?: unknown;
    entries?: Record<string, { enabled?: boolean; env?: Record<string, string> }>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export function readOpenClawConfig(): OpenClawConfig {
  const configPath = getOpenClawConfigPath();
  try {
    if (fs.existsSync(configPath)) {
      try {
        return JSON.parse(fs.readFileSync(configPath, 'utf-8')) as OpenClawConfig;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EACCES') {
          // File owned by agent user — read via sudo
          const agentHome = process.env['AGENSHIELD_AGENT_HOME'] || '/Users/ash_default_agent';
          const agentUsername = path.basename(agentHome);
          const raw = execSync(
            `sudo -H -u ${agentUsername} cat "${configPath}"`,
            { encoding: 'utf-8', cwd: '/', stdio: ['pipe', 'pipe', 'pipe'] }
          );
          // Fix permissions so future reads don't need sudo
          try { fs.chmodSync(configPath, 0o664); } catch {
            try { execSync(`chmod 664 "${configPath}"`, { stdio: 'pipe' }); } catch { /* best-effort */ }
          }
          return JSON.parse(raw) as OpenClawConfig;
        }
        throw err;
      }
    }
  } catch {
    console.warn('[OpenClawConfig] Failed to read openclaw.json, starting fresh');
  }
  return {};
}

function writeConfig(config: OpenClawConfig): void {
  const configPath = getOpenClawConfigPath();
  const agentHome = process.env['AGENSHIELD_AGENT_HOME'] || '/Users/ash_default_agent';
  const agentUsername = path.basename(agentHome);

  const configDir = path.dirname(configPath);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true, mode: 0o2775 });
    // Fix group ownership so agent + broker can both access
    const socketGroup = process.env['AGENSHIELD_SOCKET_GROUP'] || 'ash_default';
    try { execSync(`chown :${socketGroup} "${configDir}"`, { stdio: 'pipe' }); } catch { /* best-effort */ }
  }

  // Sanitize agents.defaults.workspace — must point to agent home, not the host user.
  // copyOpenClawConfig's sed rewrite can fail silently, and openclaw onboard may
  // regenerate the path from the wrong HOME, so self-heal on every write.
  const correctWorkspace = path.join(agentHome, '.openclaw', 'workspace');
  const raw = config as Record<string, unknown>;
  if (raw.agents && typeof raw.agents === 'object') {
    const agents = raw.agents as Record<string, unknown>;
    if (agents.defaults && typeof agents.defaults === 'object') {
      const defaults = agents.defaults as Record<string, unknown>;
      if (typeof defaults.workspace === 'string' && defaults.workspace !== correctWorkspace) {
        defaults.workspace = correctWorkspace;
      }
    }
  }

  // Log every write with a summary of what's changing
  const skillsSummary = config.skills?.entries
    ? Object.entries(config.skills.entries).map(([k, v]) => `${k}:${v?.enabled}`).join(', ')
    : 'none';
  const caller = new Error().stack?.split('\n')[2]?.trim() || 'unknown';
  console.log(`[OpenClawConfig] Writing config — entries: [${skillsSummary}], allowBundled: [${config.skills?.allowBundled?.join(', ') || ''}], caller: ${caller}`);

  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EACCES') {
      // File may have been recreated by openclaw gateway with agent ownership.
      // Write via sudo as the agent user instead (sudoers rule grants NOPASSWD for tee).
      execSync(
        `sudo -H -u ${agentUsername} tee "${configPath}" > /dev/null`,
        { input: JSON.stringify(config, null, 2), stdio: ['pipe', 'pipe', 'pipe'], cwd: '/' }
      );
    } else {
      throw err;
    }
  }

  // Restore intended permissions (664) so broker + gateway can both read/write.
  // Setup seeds the file as broker:socketGroup 664 but OpenClaw CLI or tee
  // may recreate it with umask 077 → mode 600, breaking group reads.
  try {
    fs.chmodSync(configPath, 0o664);
  } catch {
    try {
      execSync(`chmod 664 "${configPath}"`, { stdio: 'pipe' });
    } catch { /* best-effort */ }
  }
}

/**
 * Add a skill entry to openclaw.json with enabled: true.
 * Never writes env — AgenShield handles secrets via vault/broker.
 */
export function addSkillEntry(slug: string): void {
  const config = readOpenClawConfig();

  if (!config.skills) {
    config.skills = {};
  }
  if (!config.skills.entries) {
    config.skills.entries = {};
  }

  const existing = config.skills.entries[slug] ?? {};
  config.skills.entries[slug] = { ...existing, enabled: true };

  writeConfig(config);
  console.log(`[OpenClawConfig] Added skill entry: ${slug}`);
}

/**
 * Remove a skill entry from openclaw.json.
 */
export function removeSkillEntry(slug: string): void {
  const config = readOpenClawConfig();

  if (config.skills?.entries?.[slug]) {
    const existing = config.skills.entries[slug];
    delete existing.env;
    config.skills.entries[slug] = { ...existing, enabled: false };
    writeConfig(config);
    console.log(`[OpenClawConfig] Disabled skill entry: ${slug}`);
  }
}

/**
 * Sync openclaw.json with the current AgenShield policy state.
 *
 * - Sets `skills.allowBundled` from enabled skill policies
 * - Ensures `skills.load.watch = true`
 * - Removes `skills.install` section (AgenShield handles installation)
 * - Strips `env` from all entries (AgenShield handles secrets)
 */
export function syncOpenClawFromPolicies(policies: PolicyConfig[]): void {
  const config = readOpenClawConfig();
  if (!config.skills) config.skills = {};

  // 1. Sync allowBundled from enabled skill policies
  const allowBundled: string[] = [];
  for (const p of policies) {
    if (p.target === 'skill' && p.action === 'allow' && p.enabled) {
      for (const pattern of p.patterns) {
        if (!allowBundled.includes(pattern)) allowBundled.push(pattern);
      }
    }
  }
  config.skills.allowBundled = allowBundled;

  // 2. Ensure load.watch is enabled
  if (!config.skills.load) config.skills.load = {};
  config.skills.load.watch = true;

  // 3. Remove install section — AgenShield handles installation
  delete config.skills.install;

  // 4. Strip env from all entries
  if (config.skills.entries) {
    for (const key of Object.keys(config.skills.entries)) {
      const entry = config.skills.entries[key];
      if (entry && 'env' in entry) delete entry.env;
    }
  }

  // 5. Sync entries: every skill in allowBundled must have enabled: true
  if (!config.skills.entries) config.skills.entries = {};
  for (const name of allowBundled) {
    const existing = config.skills.entries[name] ?? {};
    config.skills.entries[name] = { ...existing, enabled: true };
  }

  // 6. Enable native commands — AgenShield broker handles command policy
  if (!config.commands) (config as Record<string, unknown>).commands = {};
  const commands = (config as Record<string, unknown>).commands as Record<string, unknown>;
  commands.native = true;
  commands.nativeSkills = true;


  writeConfig(config);
  console.log(`[OpenClawConfig] Synced: allowBundled=[${allowBundled.join(', ')}], entries synced, commands.native=always`);
}
