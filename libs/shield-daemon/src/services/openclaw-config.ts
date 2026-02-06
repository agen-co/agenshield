/**
 * OpenClaw Config Service
 *
 * Helpers to manage per-skill entries in $AGENT_HOME/.openclaw/openclaw.json.
 * Skills are configured under skills.entries.<skillKey> with { enabled: boolean }.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

function getOpenClawConfigPath(): string {
  const agentHome = process.env['AGENSHIELD_AGENT_HOME'] || '/Users/ash_default_agent';
  return path.join(agentHome, '.openclaw', 'openclaw.json');
}

interface OpenClawConfig {
  skills?: {
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
  const socketGroup = process.env['AGENSHIELD_SOCKET_GROUP'] || 'clawshield';
  try {
    execSync(`chown ${brokerUser}:${socketGroup} "${configPath}"`, { stdio: 'pipe' });
    execSync(`chmod 664 "${configPath}"`, { stdio: 'pipe' });
  } catch {
    // May fail if not root — acceptable in development
  }
}

/**
 * Add a skill entry to openclaw.json with enabled: true.
 */
export function addSkillEntry(slug: string, env?: Record<string, string>): void {
  const config = readConfig();

  if (!config.skills) {
    config.skills = {};
  }
  if (!config.skills.entries) {
    config.skills.entries = {};
  }

  config.skills.entries[slug] = {
    enabled: true,
    ...(env && Object.keys(env).length > 0 ? { env } : {}),
  };

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
