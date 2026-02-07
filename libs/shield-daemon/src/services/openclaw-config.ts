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

function readConfig(): OpenClawConfig {
  const configPath = getOpenClawConfigPath();
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8')) as OpenClawConfig;
    }
  } catch {
    console.warn('[OpenClawConfig] Failed to read openclaw.json, starting fresh');
  }
  return {};
}

function writeConfig(config: OpenClawConfig): void {
  const configPath = getOpenClawConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

  // Fix ownership so the broker user can update the file in the future,
  // even when the daemon (running as root) was the one that created it.
  const agentHome = process.env['AGENSHIELD_AGENT_HOME'] || '/Users/ash_default_agent';
  const brokerUser = path.basename(agentHome) + '_broker';
  const socketGroup = process.env['AGENSHIELD_SOCKET_GROUP'] || 'ash_default';
  try {
    execSync(`chown ${brokerUser}:${socketGroup} "${configPath}"`, { stdio: 'pipe' });
    execSync(`chmod 664 "${configPath}"`, { stdio: 'pipe' });
  } catch {
    // May fail if not root — acceptable in development
  }
}

/**
 * Add a skill entry to openclaw.json with enabled: true.
 * Never writes env — AgenShield handles secrets via vault/broker.
 */
export function addSkillEntry(slug: string): void {
  const config = readConfig();

  if (!config.skills) {
    config.skills = {};
  }
  if (!config.skills.entries) {
    config.skills.entries = {};
  }

  config.skills.entries[slug] = { enabled: true };

  writeConfig(config);
  console.log(`[OpenClawConfig] Added skill entry: ${slug}`);
}

/**
 * Remove a skill entry from openclaw.json.
 */
export function removeSkillEntry(slug: string): void {
  const config = readConfig();

  if (config.skills?.entries?.[slug]) {
    delete config.skills.entries[slug];
    writeConfig(config);
    console.log(`[OpenClawConfig] Removed skill entry: ${slug}`);
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
  const config = readConfig();
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

  writeConfig(config);
  console.log(`[OpenClawConfig] Synced: allowBundled=[${allowBundled.join(', ')}], load.watch=true`);
}
