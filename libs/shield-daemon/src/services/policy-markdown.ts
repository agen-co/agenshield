/**
 * Policy Markdown Generator
 *
 * Generates a semantic Markdown document from the active policy configuration.
 * The document describes what the agent is allowed and denied to do, written
 * as natural-language instructions that OpenClaw can use to be more effective.
 */

import type { PolicyConfig } from '@agenshield/ipc';
import { COMMAND_CATALOG } from '@agenshield/ipc';

/**
 * Describe a command pattern in human-readable terms.
 */
function describeCommandPattern(pattern: string): string {
  if (pattern === '*') return 'any command';
  if (pattern.endsWith(':*')) {
    const prefix = pattern.slice(0, -2);
    const entry = COMMAND_CATALOG[prefix.split(/\s+/)[0]];
    const desc = entry ? ` — ${entry.description}` : '';
    return `\`${prefix}\` with any arguments${desc}`;
  }
  const base = pattern.split(/\s+/)[0];
  const entry = COMMAND_CATALOG[base];
  const desc = entry ? ` — ${entry.description}` : '';
  return `exactly \`${pattern}\`${desc}`;
}

/**
 * Describe a URL pattern in human-readable terms.
 */
function describeUrlPattern(pattern: string): string {
  if (pattern === '*') return 'any URL';
  return `\`${pattern}\` (and sub-paths)`;
}

/**
 * Describe a filesystem pattern in human-readable terms.
 */
function describeFilesystemPattern(pattern: string, operations?: string[]): string {
  const ops = (operations ?? []).map((o) => {
    if (o === 'file_read') return 'read';
    if (o === 'file_write') return 'write';
    return o;
  });
  const opsStr = ops.length > 0 ? ` (${ops.join(', ')})` : '';
  return `\`${pattern}\`${opsStr}`;
}

interface GroupedPolicies {
  allowCommands: PolicyConfig[];
  denyCommands: PolicyConfig[];
  allowUrls: PolicyConfig[];
  denyUrls: PolicyConfig[];
  allowFilesystem: PolicyConfig[];
  denyFilesystem: PolicyConfig[];
  allowSkills: PolicyConfig[];
  denySkills: PolicyConfig[];
}

function groupPolicies(policies: PolicyConfig[]): GroupedPolicies {
  const groups: GroupedPolicies = {
    allowCommands: [],
    denyCommands: [],
    allowUrls: [],
    denyUrls: [],
    allowFilesystem: [],
    denyFilesystem: [],
    allowSkills: [],
    denySkills: [],
  };

  for (const p of policies) {
    if (!p.enabled) continue;
    const key = `${p.action}${p.target.charAt(0).toUpperCase()}${p.target.slice(1)}` as string;
    // Map target types to group keys
    if (p.target === 'command') {
      (p.action === 'allow' ? groups.allowCommands : groups.denyCommands).push(p);
    } else if (p.target === 'url') {
      (p.action === 'allow' ? groups.allowUrls : groups.denyUrls).push(p);
    } else if (p.target === 'filesystem') {
      (p.action === 'allow' ? groups.allowFilesystem : groups.denyFilesystem).push(p);
    } else if (p.target === 'skill') {
      (p.action === 'allow' ? groups.allowSkills : groups.denySkills).push(p);
    }
  }

  return groups;
}

/**
 * Generate a semantic Markdown document from the active policy configuration.
 * Meant to be injected into OpenClaw as instructions so it knows what it can do.
 *
 * @param knownSkills — If provided, skill policy patterns that don't match
 *   any known skill name are filtered out. Policies with no remaining patterns
 *   are omitted entirely.
 */
export function generatePolicyMarkdown(policies: PolicyConfig[], knownSkills?: Set<string>): string {
  const groups = groupPolicies(policies);
  const lines: string[] = [];

  lines.push('# AgenShield Policy Instructions');
  lines.push('');
  lines.push('These are the security policies enforced by AgenShield. Follow these constraints when executing tasks.');
  lines.push('');

  // ── Commands ────────────────────────────────────────────────────────

  const hasCommands = groups.allowCommands.length > 0 || groups.denyCommands.length > 0;
  if (hasCommands) {
    lines.push('## Commands');
    lines.push('');

    if (groups.allowCommands.length > 0) {
      lines.push('### Allowed Commands');
      lines.push('');
      lines.push('You may execute the following commands:');
      lines.push('');
      for (const p of groups.allowCommands) {
        lines.push(`**${p.name}**${p.preset ? ` _(${p.preset} preset)_` : ''}:`);
        for (const pattern of p.patterns) {
          lines.push(`- ${describeCommandPattern(pattern)}`);
        }
        lines.push('');
      }
    }

    if (groups.denyCommands.length > 0) {
      lines.push('### Denied Commands');
      lines.push('');
      lines.push('You must NOT execute the following commands:');
      lines.push('');
      for (const p of groups.denyCommands) {
        lines.push(`**${p.name}**:`);
        for (const pattern of p.patterns) {
          lines.push(`- ${describeCommandPattern(pattern)}`);
        }
        lines.push('');
      }
    }
  }

  // ── URLs / Network ──────────────────────────────────────────────────

  const hasUrls = groups.allowUrls.length > 0 || groups.denyUrls.length > 0;
  if (hasUrls) {
    lines.push('## Network / URLs');
    lines.push('');
    lines.push('Plain HTTP requests are blocked by default. Use HTTPS.');
    lines.push('');

    if (groups.allowUrls.length > 0) {
      lines.push('### Allowed URLs');
      lines.push('');
      lines.push('You may make HTTP requests to:');
      lines.push('');
      for (const p of groups.allowUrls) {
        lines.push(`**${p.name}**${p.preset ? ` _(${p.preset} preset)_` : ''}:`);
        for (const pattern of p.patterns) {
          lines.push(`- ${describeUrlPattern(pattern)}`);
        }
        lines.push('');
      }
    }

    if (groups.denyUrls.length > 0) {
      lines.push('### Denied URLs');
      lines.push('');
      lines.push('You must NOT make requests to:');
      lines.push('');
      for (const p of groups.denyUrls) {
        lines.push(`**${p.name}**:`);
        for (const pattern of p.patterns) {
          lines.push(`- ${describeUrlPattern(pattern)}`);
        }
        lines.push('');
      }
    }
  }

  // ── Filesystem ──────────────────────────────────────────────────────

  const hasFs = groups.allowFilesystem.length > 0 || groups.denyFilesystem.length > 0;
  if (hasFs) {
    lines.push('## Filesystem Access');
    lines.push('');

    if (groups.allowFilesystem.length > 0) {
      lines.push('### Allowed Paths');
      lines.push('');
      for (const p of groups.allowFilesystem) {
        lines.push(`**${p.name}**:`);
        for (const pattern of p.patterns) {
          lines.push(`- ${describeFilesystemPattern(pattern, p.operations)}`);
        }
        lines.push('');
      }
    }

    if (groups.denyFilesystem.length > 0) {
      lines.push('### Denied Paths');
      lines.push('');
      for (const p of groups.denyFilesystem) {
        lines.push(`**${p.name}**:`);
        for (const pattern of p.patterns) {
          lines.push(`- ${describeFilesystemPattern(pattern, p.operations)}`);
        }
        lines.push('');
      }
    }
  }

  // ── Skills ──────────────────────────────────────────────────────────

  // Filter skill policies to only include patterns that match known skills
  const filterSkillPatterns = (policies: PolicyConfig[]): PolicyConfig[] => {
    if (!knownSkills) return policies;
    return policies
      .map((p) => ({ ...p, patterns: p.patterns.filter((s) => knownSkills.has(s)) }))
      .filter((p) => p.patterns.length > 0);
  };

  const filteredAllowSkills = filterSkillPatterns(groups.allowSkills);
  const filteredDenySkills = filterSkillPatterns(groups.denySkills);

  const hasSkills = filteredAllowSkills.length > 0 || filteredDenySkills.length > 0;
  if (hasSkills) {
    lines.push('## Skills');
    lines.push('');

    if (filteredAllowSkills.length > 0) {
      lines.push('### Allowed Skills');
      lines.push('');
      for (const p of filteredAllowSkills) {
        lines.push(`**${p.name}**: ${p.patterns.map((s) => `\`${s}\``).join(', ')}`);
      }
      lines.push('');
    }

    if (filteredDenySkills.length > 0) {
      lines.push('### Denied Skills');
      lines.push('');
      for (const p of filteredDenySkills) {
        lines.push(`**${p.name}**: ${p.patterns.map((s) => `\`${s}\``).join(', ')}`);
      }
      lines.push('');
    }
  }

  // ── Footer ──────────────────────────────────────────────────────────

  if (!hasCommands && !hasUrls && !hasFs && !hasSkills) {
    lines.push('No policies are currently configured. All operations are allowed by default.');
    lines.push('');
  }

  lines.push('---');
  lines.push(`_Generated by AgenShield at ${new Date().toISOString()}_`);
  lines.push('');

  return lines.join('\n');
}
