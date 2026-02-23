/**
 * Host Scanner
 *
 * Scans the host system for environment variables, secrets, and skills
 * from multiple sources: application config, process.env, and shell profiles.
 *
 * IMPORTANT: This module is strictly READ-ONLY. It never writes to any file
 * or modifies any source data. All operations use fs.readFileSync/existsSync only.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { isSecretEnvVar } from './security';
import type {
  ScannedSkill,
  ScannedEnvVar,
  MigrationScanResult,
} from '@agenshield/ipc';

// ============================================================================
// Config scanning (openclaw.json)
// ============================================================================

interface OpenClawConfigShape {
  skills?: {
    entries?: Record<string, { enabled?: boolean; env?: Record<string, string> }>;
  };
}

/**
 * Read openclaw.json (or similar app config) and extract skills + env vars.
 * Returns skills and associated env vars. Never modifies the file.
 */
export function scanOpenClawConfig(configJsonPath: string): {
  skills: ScannedSkill[];
  envVars: ScannedEnvVar[];
  warnings: string[];
} {
  const skills: ScannedSkill[] = [];
  const envVars: ScannedEnvVar[] = [];
  const warnings: string[] = [];

  // Compute dirs early — they are valid even if the config file is missing
  const configDir = path.dirname(configJsonPath);
  const skillsDir = path.join(configDir, 'skills');

  // 1. Try to read config entries (may not exist)
  let entries: Record<string, { enabled?: boolean; env?: Record<string, string> }> | undefined;
  if (fs.existsSync(configJsonPath)) {
    try {
      const config: OpenClawConfigShape = JSON.parse(fs.readFileSync(configJsonPath, 'utf-8'));
      entries = config.skills?.entries;
    } catch (err) {
      warnings.push(`Failed to parse config: ${(err as Error).message}`);
    }
  } else {
    warnings.push(`Config file not found: ${configJsonPath}`);
  }

  // 2. Process configured entries
  if (entries) {
    for (const [name, entry] of Object.entries(entries)) {
      const skillPath = path.join(skillsDir, name);
      const skillExists = fs.existsSync(skillPath);
      const skillMdPath = path.join(skillPath, 'SKILL.md');
      const hasSkillMd = skillExists && fs.existsSync(skillMdPath);

      let description: string | undefined;
      if (hasSkillMd) {
        try {
          const content = fs.readFileSync(skillMdPath, 'utf-8');
          const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
          if (fmMatch) {
            const descMatch = fmMatch[1].match(/description:\s*(.+)/);
            if (descMatch) {
              description = descMatch[1].trim().replace(/^["']|["']$/g, '');
            }
          }
        } catch {
          // Best effort
        }
      }

      skills.push({
        name,
        enabled: entry.enabled !== false,
        envVars: entry.env ?? {},
        skillPath: skillExists ? skillPath : undefined,
        hasSkillMd,
        description,
      });

      if (entry.env) {
        for (const [envName, envValue] of Object.entries(entry.env)) {
          envVars.push({
            name: envName,
            maskedValue: maskSecretValue(envValue),
            source: 'app-config',
            isSecret: isSecretEnvVar(envName),
            associatedSkill: name,
          });
        }
      }
    }
  }

  // 3. Scan skills/ directory for skills not already discovered via config
  if (fs.existsSync(skillsDir)) {
    const configSkillNames = new Set(skills.map(s => s.name));
    try {
      const dirEntries = fs.readdirSync(skillsDir, { withFileTypes: true });
      for (const dirEntry of dirEntries) {
        if (!dirEntry.isDirectory() || configSkillNames.has(dirEntry.name)) continue;
        const skillPath = path.join(skillsDir, dirEntry.name);
        const skillMdPath = path.join(skillPath, 'SKILL.md');
        const pkgJsonPath = path.join(skillPath, 'package.json');
        const hasSkillMd = fs.existsSync(skillMdPath);
        // Skip directories that don't look like skills
        if (!hasSkillMd && !fs.existsSync(pkgJsonPath)) continue;

        let description: string | undefined;
        if (hasSkillMd) {
          try {
            const content = fs.readFileSync(skillMdPath, 'utf-8');
            const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
            if (fmMatch) {
              const descMatch = fmMatch[1].match(/description:\s*(.+)/);
              if (descMatch) {
                description = descMatch[1].trim().replace(/^["']|["']$/g, '');
              }
            }
          } catch {
            // Best effort
          }
        }

        skills.push({
          name: dirEntry.name,
          enabled: false,
          envVars: {},
          skillPath,
          hasSkillMd,
          description,
        });
      }
    } catch {
      warnings.push(`Could not read skills directory: ${skillsDir}`);
    }
  }

  return { skills, envVars, warnings };
}

// ============================================================================
// Process.env scanning
// ============================================================================

/**
 * Scan process.env for env vars that look like secrets.
 */
export function scanProcessEnv(): ScannedEnvVar[] {
  const envVars: ScannedEnvVar[] = [];

  for (const [key, value] of Object.entries(process.env)) {
    if (!value) continue;
    if (!isSecretEnvVar(key)) continue;

    envVars.push({
      name: key,
      maskedValue: maskSecretValue(value),
      source: 'process-env',
      isSecret: true,
    });
  }

  return envVars;
}

// ============================================================================
// Shell profile scanning
// ============================================================================

/** Shell profiles to scan, in priority order */
const SHELL_PROFILES = [
  '.zshrc',
  '.bashrc',
  '.profile',
  '.bash_profile',
  '.zprofile',
];

/**
 * Regex to match `export KEY=VALUE` or `export KEY="VALUE"` or `export KEY='VALUE'`
 */
const EXPORT_REGEX = /^\s*export\s+([A-Za-z_][A-Za-z0-9_]*)=(.+)$/;

/**
 * Scan shell profiles for exported environment variables.
 */
export function scanShellProfiles(home: string): {
  envVars: ScannedEnvVar[];
  scannedProfiles: string[];
  warnings: string[];
} {
  const envVars: ScannedEnvVar[] = [];
  const scannedProfiles: string[] = [];
  const warnings: string[] = [];

  for (const profile of SHELL_PROFILES) {
    const filePath = path.join(home, profile);
    if (!fs.existsSync(filePath)) continue;

    scannedProfiles.push(filePath);

    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch (err) {
      warnings.push(`Could not read ${filePath}: ${(err as Error).message}`);
      continue;
    }

    for (const line of content.split('\n')) {
      const match = line.match(EXPORT_REGEX);
      if (!match) continue;

      const name = match[1];
      let value = match[2].trim();

      // Remove surrounding quotes
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      // Remove inline comments (only for unquoted values)
      const commentIdx = value.indexOf(' #');
      if (commentIdx > 0) {
        value = value.slice(0, commentIdx).trim();
      }

      // Skip variable references and command substitutions
      if (value.includes('$(') || value.includes('${') || value.startsWith('$')) {
        continue;
      }

      envVars.push({
        name,
        maskedValue: maskSecretValue(value),
        source: 'shell-profile',
        profilePath: filePath,
        isSecret: isSecretEnvVar(name),
      });
    }
  }

  return { envVars, scannedProfiles, warnings };
}

// ============================================================================
// Value masking
// ============================================================================

/**
 * Mask a secret value for display. Shows first 3 and last 4 chars for long values.
 */
export function maskSecretValue(value: string): string {
  if (value.length <= 8) {
    return '****';
  }
  return `${value.slice(0, 3)}...${value.slice(-4)}`;
}

// ============================================================================
// Value resolution (for migration time)
// ============================================================================

/**
 * Resolve the actual (unmasked) value of an env var from its original source.
 * Called at migration time when the user has confirmed which secrets to import.
 */
export function resolveEnvVarValue(
  name: string,
  source: ScannedEnvVar['source'],
  profilePath?: string,
  configJsonPath?: string,
): string | null {
  switch (source) {
    case 'process-env':
      return process.env[name] ?? null;

    case 'shell-profile': {
      if (!profilePath || !fs.existsSync(profilePath)) return null;
      try {
        const content = fs.readFileSync(profilePath, 'utf-8');
        for (const line of content.split('\n')) {
          const match = line.match(EXPORT_REGEX);
          if (!match || match[1] !== name) continue;
          let value = match[2].trim();
          if ((value.startsWith('"') && value.endsWith('"')) ||
              (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }
          return value;
        }
      } catch {
        // Best effort
      }
      return null;
    }

    case 'app-config': {
      if (!configJsonPath || !fs.existsSync(configJsonPath)) return null;
      try {
        const config: OpenClawConfigShape = JSON.parse(
          fs.readFileSync(configJsonPath, 'utf-8'),
        );
        const entries = config.skills?.entries;
        if (!entries) return null;
        for (const entry of Object.values(entries)) {
          if (entry.env?.[name]) return entry.env[name];
        }
      } catch {
        // Best effort
      }
      return null;
    }

    default:
      return null;
  }
}

// ============================================================================
// Orchestrator
// ============================================================================

/**
 * Resolve home directory, accounting for sudo.
 */
function getHome(): string {
  const sudoUser = process.env['SUDO_USER'];
  if (sudoUser) {
    const userHome = path.join('/Users', sudoUser);
    if (fs.existsSync(userHome)) return userHome;
  }
  return os.homedir();
}

export interface ScanHostOptions {
  /** Path to the application config file (e.g. ~/.openclaw/openclaw.json) */
  configPath?: string;
  /** Home directory to scan for shell profiles (defaults to current user home) */
  home?: string;
}

/**
 * Scan the host for skills and environment variables from all sources.
 * Deduplicates env vars, preferring more specific sources:
 * app-config > shell-profile > process-env
 */
export function scanHost(options: ScanHostOptions = {}): MigrationScanResult {
  const home = options.home ?? getHome();
  const warnings: string[] = [];
  let skills: ScannedSkill[] = [];
  let configEnvVars: ScannedEnvVar[] = [];

  // 1. Scan app config
  if (options.configPath) {
    const configResult = scanOpenClawConfig(options.configPath);
    skills = configResult.skills;
    configEnvVars = configResult.envVars;
    warnings.push(...configResult.warnings);
  }

  // 2. Scan shell profiles
  const profileResult = scanShellProfiles(home);
  warnings.push(...profileResult.warnings);

  // 3. Scan process.env
  const processEnvVars = scanProcessEnv();

  // 4. Deduplicate: app-config > shell-profile > process-env
  const seen = new Set<string>();
  const allEnvVars: ScannedEnvVar[] = [];

  // Add config vars first (highest priority)
  for (const v of configEnvVars) {
    if (!seen.has(v.name)) {
      seen.add(v.name);
      allEnvVars.push(v);
    }
  }

  // Add shell profile vars
  for (const v of profileResult.envVars) {
    if (!seen.has(v.name)) {
      seen.add(v.name);
      allEnvVars.push(v);
    }
  }

  // Add process.env vars
  for (const v of processEnvVars) {
    if (!seen.has(v.name)) {
      seen.add(v.name);
      allEnvVars.push(v);
    }
  }

  return {
    skills,
    envVars: allEnvVars,
    configPath: options.configPath,
    scannedProfiles: profileResult.scannedProfiles,
    scannedAt: new Date().toISOString(),
    warnings,
  };
}
