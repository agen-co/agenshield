/**
 * Skill Analyzer Service
 *
 * MVP: Extracts commands from skill metadata (frontmatter) and content (regex).
 * Cloud API integration can be added later.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import type { SkillAnalysis, ExtractedCommand } from '@agenshield/ipc';

const ANALYSIS_CACHE_PATH = '/opt/agenshield/config/skill-analyses.json';

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

interface AnalysisCache {
  [skillName: string]: SkillAnalysis;
}

function loadCache(): AnalysisCache {
  try {
    if (fs.existsSync(ANALYSIS_CACHE_PATH)) {
      return JSON.parse(fs.readFileSync(ANALYSIS_CACHE_PATH, 'utf-8'));
    }
  } catch {
    // Cache might be corrupted
  }
  return {};
}

function saveCache(cache: AnalysisCache): void {
  try {
    const dir = path.dirname(ANALYSIS_CACHE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(ANALYSIS_CACHE_PATH, JSON.stringify(cache, null, 2) + '\n', 'utf-8');
  } catch (err) {
    console.error('[SkillAnalyzer] Failed to save cache:', (err as Error).message);
  }
}

/**
 * Resolve a command name to its absolute path
 */
function resolveCommand(name: string): string | undefined {
  try {
    const result = execSync(`which ${name} 2>/dev/null`, { encoding: 'utf-8' }).trim();
    return result || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Extract commands from skill metadata (frontmatter fields)
 */
function extractFromMetadata(metadata: Record<string, unknown>): ExtractedCommand[] {
  const commands: ExtractedCommand[] = [];

  // Check requires.bins
  const requires = metadata.requires as Record<string, unknown> | undefined;
  if (requires?.bins && Array.isArray(requires.bins)) {
    for (const bin of requires.bins) {
      if (typeof bin === 'string') {
        const resolved = resolveCommand(bin);
        commands.push({
          name: bin,
          source: 'metadata',
          field: 'requires.bins',
          resolvedPath: resolved,
          available: !!resolved,
          required: true,
        });
      }
    }
  }

  // Check agenshield.allowedCommands
  const agenshield = metadata.agenshield as Record<string, unknown> | undefined;
  if (agenshield?.allowedCommands && Array.isArray(agenshield.allowedCommands)) {
    for (const cmd of agenshield.allowedCommands) {
      if (typeof cmd === 'string' && !commands.some((c) => c.name === cmd)) {
        const resolved = resolveCommand(cmd);
        commands.push({
          name: cmd,
          source: 'metadata',
          field: 'agenshield.allowedCommands',
          resolvedPath: resolved,
          available: !!resolved,
          required: false,
        });
      }
    }
  }

  return commands;
}

/**
 * Extract commands from skill content using regex patterns
 */
function extractFromContent(content: string): ExtractedCommand[] {
  const found = new Set<string>();

  for (const pattern of COMMAND_PATTERNS) {
    // Reset lastIndex for global patterns
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const cmd = match[1];
      if (cmd && !IGNORE_WORDS.has(cmd.toLowerCase()) && cmd.length > 1) {
        found.add(cmd);
      }
    }
  }

  const commands: ExtractedCommand[] = [];
  for (const name of found) {
    const resolved = resolveCommand(name);
    // Only include commands that actually exist on the system
    if (resolved) {
      commands.push({
        name,
        source: 'analysis',
        resolvedPath: resolved,
        available: true,
        required: false,
      });
    }
  }

  return commands;
}

/**
 * Analyze a skill and return analysis results.
 * MVP: metadata extraction + regex detection.
 */
export function analyzeSkill(
  skillName: string,
  content: string,
  metadata?: Record<string, unknown>
): SkillAnalysis {
  try {
    const metadataCommands = metadata ? extractFromMetadata(metadata) : [];
    const contentCommands = extractFromContent(content);

    // Merge: metadata commands take precedence
    const metadataNames = new Set(metadataCommands.map((c) => c.name));
    const allCommands = [
      ...metadataCommands,
      ...contentCommands.filter((c) => !metadataNames.has(c.name)),
    ];

    // Basic vulnerability assessment based on commands found
    const unavailable = allCommands.filter((c) => c.required && !c.available);
    const hasRiskyCommands = allCommands.some((c) =>
      ['rm', 'sudo', 'chmod', 'chown', 'kill', 'dd', 'mkfs', 'fdisk'].includes(c.name)
    );

    let level: 'safe' | 'low' | 'medium' | 'high' | 'critical' = 'safe';
    const details: string[] = [];
    const suggestions: string[] = [];

    if (hasRiskyCommands) {
      level = 'medium';
      const risky = allCommands
        .filter((c) => ['rm', 'sudo', 'chmod', 'chown', 'kill', 'dd', 'mkfs', 'fdisk'].includes(c.name))
        .map((c) => c.name);
      details.push(`Uses potentially dangerous commands: ${risky.join(', ')}`);
      suggestions.push('Review skill content to ensure dangerous commands are used safely');
    }

    if (unavailable.length > 0) {
      if (level === 'safe') level = 'low';
      details.push(`Missing required commands: ${unavailable.map((c) => c.name).join(', ')}`);
      suggestions.push('Install missing dependencies before activating this skill');
    }

    if (allCommands.length === 0) {
      details.push('No external commands detected');
    }

    const analysis: SkillAnalysis = {
      status: 'complete',
      analyzedAt: new Date().toISOString(),
      analyzerId: 'agenshield',
      vulnerability: {
        level,
        details,
        suggestions: suggestions.length > 0 ? suggestions : undefined,
      },
      commands: allCommands,
    };

    // Cache the result
    const cache = loadCache();
    cache[skillName] = analysis;
    saveCache(cache);

    return analysis;
  } catch (err) {
    const errorAnalysis: SkillAnalysis = {
      status: 'error',
      analyzerId: 'agenshield',
      commands: [],
      error: (err as Error).message,
    };

    return errorAnalysis;
  }
}

/**
 * Get cached analysis for a skill
 */
export function getCachedAnalysis(skillName: string): SkillAnalysis | undefined {
  const cache = loadCache();
  return cache[skillName];
}

/**
 * Clear cached analysis for a skill
 */
export function clearCachedAnalysis(skillName: string): void {
  const cache = loadCache();
  delete cache[skillName];
  saveCache(cache);
}
