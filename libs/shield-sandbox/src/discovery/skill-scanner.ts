/**
 * Skill Scanner
 *
 * Scans the OpenClaw skills directory, parses SKILL.md frontmatter,
 * extracts command requirements, and cross-references with discovered binaries.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type {
  SkillMetadata,
  OpenClawSkillMetadata,
  SkillExtractedInfo,
  DiscoveredSkill,
  SkillCommandRequirement,
  DiscoveredBinary,
  DiscoveryOptions,
} from '@agenshield/ipc';
import { getSkillsDir } from '../skill-injector';

/** Path to the approved skills configuration */
const APPROVED_SKILLS_PATH = '/opt/agenshield/config/approved-skills.json';

/** Quarantine directory for unapproved skills */
const QUARANTINE_DIR = '/opt/agenshield/quarantine/skills';

/** Regex patterns to detect command usage in skill content */
const COMMAND_PATTERNS = [
  // Bash-style: command at start of line or after pipe/semicolon
  /(?:^|\||;|&&|\$\()\s*(?:sudo\s+)?([a-zA-Z][a-zA-Z0-9._-]*)\b/gm,
  // Explicit exec/run references
  /(?:exec|run|execute|spawn|shell)\s*\(\s*['"]([a-zA-Z][a-zA-Z0-9._-]*)['"]/gi,
  // Shebang lines
  /^#!\s*(?:\/usr\/bin\/env\s+)?([a-zA-Z][a-zA-Z0-9._-]*)/gm,
];

/** Common non-command words to filter out */
const IGNORE_WORDS = new Set([
  'if', 'then', 'else', 'fi', 'for', 'do', 'done', 'while', 'until',
  'case', 'esac', 'function', 'return', 'exit', 'echo', 'print',
  'true', 'false', 'null', 'undefined', 'var', 'let', 'const',
  'import', 'export', 'from', 'require', 'module', 'class',
  'the', 'and', 'or', 'not', 'is', 'are', 'was', 'were', 'be',
  'to', 'in', 'on', 'at', 'by', 'with', 'as', 'this', 'that',
]);

/** Deduplicate an array of strings */
function unique(value: string, index: number, self: string[]): boolean {
  return self.indexOf(value) === index;
}

/**
 * Extract structured info (API keys, bins, config options, install steps) from skill metadata
 */
export function extractSkillInfo(metadata: SkillMetadata | null): SkillExtractedInfo {
  const topReq = metadata?.requires;
  const oclMeta = metadata?.metadata?.openclaw ?? metadata?.metadata?.clawdbot as OpenClawSkillMetadata | undefined;
  const oclReq = oclMeta?.requires;
  return {
    apiKeys: [...(topReq?.env ?? []), ...(oclReq?.env ?? [])].filter(unique),
    bins: [...(topReq?.bins ?? []), ...(oclReq?.bins ?? [])].filter(unique),
    anyBins: [...(topReq?.anyBins ?? []), ...(oclReq?.anyBins ?? [])].filter(unique),
    configOptions: [...(topReq?.config ?? []), ...(oclReq?.config ?? [])].filter(unique),
    installSteps: oclMeta?.install,
  };
}

/**
 * Parse SKILL.md content, extracting YAML frontmatter and body
 */
export function parseSkillMd(content: string): { metadata: SkillMetadata; body: string } | null {
  // Match --- delimited frontmatter
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) {
    return null;
  }

  try {
    const rawYaml = match[1];
    const body = match[2] || '';
    const metadata = parseYaml(rawYaml) as SkillMetadata;
    if (!metadata || typeof metadata !== 'object') {
      return null;
    }
    return { metadata, body };
  } catch {
    return null;
  }
}

/**
 * Extract command requirements from metadata and content body
 */
export function extractCommands(
  metadata: SkillMetadata | null,
  body: string,
  binaryLookup: Map<string, DiscoveredBinary>,
): SkillCommandRequirement[] {
  const commands: SkillCommandRequirement[] = [];
  const seen = new Set<string>();

  // From metadata: requires.bins (required=true)
  if (metadata?.requires?.bins && Array.isArray(metadata.requires.bins)) {
    for (const bin of metadata.requires.bins) {
      if (typeof bin === 'string' && !seen.has(bin)) {
        seen.add(bin);
        const resolved = binaryLookup.get(bin);
        commands.push({
          name: bin,
          source: 'metadata',
          available: !!resolved,
          resolvedPath: resolved?.path,
          protection: resolved?.protection,
          required: true,
        });
      }
    }
  }

  // From metadata: agenshield.allowedCommands (required=false)
  if (metadata?.agenshield?.allowedCommands && Array.isArray(metadata.agenshield.allowedCommands)) {
    for (const cmd of metadata.agenshield.allowedCommands) {
      if (typeof cmd === 'string' && !seen.has(cmd)) {
        seen.add(cmd);
        const resolved = binaryLookup.get(cmd);
        commands.push({
          name: cmd,
          source: 'metadata',
          available: !!resolved,
          resolvedPath: resolved?.path,
          protection: resolved?.protection,
          required: false,
        });
      }
    }
  }

  // From content: regex patterns
  for (const pattern of COMMAND_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(body)) !== null) {
      const cmd = match[1];
      if (cmd && !seen.has(cmd) && !IGNORE_WORDS.has(cmd.toLowerCase()) && cmd.length > 1) {
        seen.add(cmd);
        const resolved = binaryLookup.get(cmd);
        // Only include commands that exist in the binary lookup
        if (resolved) {
          commands.push({
            name: cmd,
            source: 'analysis',
            available: true,
            resolvedPath: resolved.path,
            protection: resolved.protection,
            required: false,
          });
        }
      }
    }
  }

  return commands;
}

/**
 * Get the approval status of a skill
 */
export function getApprovalStatus(
  skillName: string,
): 'approved' | 'quarantined' | 'unknown' {
  // Check approved list
  try {
    if (fs.existsSync(APPROVED_SKILLS_PATH)) {
      const content = fs.readFileSync(APPROVED_SKILLS_PATH, 'utf-8');
      const approved = JSON.parse(content) as { name: string }[];
      if (Array.isArray(approved) && approved.some((s) => s.name === skillName)) {
        return 'approved';
      }
    }
  } catch {
    // Ignore
  }

  // Check quarantine directory
  try {
    const quarantinePath = path.join(QUARANTINE_DIR, skillName);
    if (fs.existsSync(quarantinePath)) {
      return 'quarantined';
    }
  } catch {
    // Ignore
  }

  return 'unknown';
}

/**
 * Scan the skills directory and return discovered skills
 */
export function scanSkills(
  options: DiscoveryOptions,
  binaryLookup: Map<string, DiscoveredBinary>,
): DiscoveredSkill[] {
  if (!options.agentHome) return [];

  const skillsDir = getSkillsDir(options.agentHome);
  const results: DiscoveredSkill[] = [];

  // Scan the active skills directory
  if (fs.existsSync(skillsDir)) {
    try {
      const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const skillPath = path.join(skillsDir, entry.name);
        const skillMdPath = path.join(skillPath, 'SKILL.md');
        const hasSkillMd = fs.existsSync(skillMdPath);

        let metadata: SkillMetadata | null = null;
        let body = '';

        if (hasSkillMd) {
          try {
            const content = fs.readFileSync(skillMdPath, 'utf-8');
            const parsed = parseSkillMd(content);
            if (parsed) {
              metadata = parsed.metadata;
              body = parsed.body;
            }
          } catch {
            // Skip unparseable SKILL.md
          }
        }

        const requiredCommands = extractCommands(metadata, body, binaryLookup);

        results.push({
          name: entry.name,
          path: skillPath,
          hasSkillMd,
          metadata,
          requiredCommands,
          approval: getApprovalStatus(entry.name),
          extractedInfo: extractSkillInfo(metadata),
        });
      }
    } catch {
      // Skills dir unreadable
    }
  }

  // Also scan quarantined skills
  if (fs.existsSync(QUARANTINE_DIR)) {
    try {
      const entries = fs.readdirSync(QUARANTINE_DIR, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        // Skip if already found in active dir
        if (results.some((s) => s.name === entry.name)) continue;

        const skillPath = path.join(QUARANTINE_DIR, entry.name);
        const skillMdPath = path.join(skillPath, 'SKILL.md');
        const hasSkillMd = fs.existsSync(skillMdPath);

        let metadata: SkillMetadata | null = null;
        let body = '';

        if (hasSkillMd) {
          try {
            const content = fs.readFileSync(skillMdPath, 'utf-8');
            const parsed = parseSkillMd(content);
            if (parsed) {
              metadata = parsed.metadata;
              body = parsed.body;
            }
          } catch {
            // Skip
          }
        }

        const requiredCommands = extractCommands(metadata, body, binaryLookup);

        results.push({
          name: entry.name,
          path: skillPath,
          hasSkillMd,
          metadata,
          requiredCommands,
          approval: 'quarantined',
          extractedInfo: extractSkillInfo(metadata),
        });
      }
    } catch {
      // Quarantine dir unreadable
    }
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}
