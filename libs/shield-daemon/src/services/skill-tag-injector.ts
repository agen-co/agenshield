/**
 * Skill Tag Injector
 *
 * Utilities for injecting and extracting AgenShield installation tags
 * in SKILL.md YAML frontmatter. Used to mark skills as installed by
 * this AgenShield instance for trust verification.
 */

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { getInstallationTag } from '../vault/installation-key';

/** Regex to match YAML frontmatter delimited by --- */
const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/;

/**
 * Inject the AgenShield installation tag into SKILL.md content.
 *
 * Handles:
 *  - Files with existing tags array (appends)
 *  - Files with no tags field (creates it)
 *  - Files with no frontmatter (prepends frontmatter block)
 *  - Replaces any existing agenshield-* tag (re-tag for this installation)
 *
 * Should be called AFTER stripEnvFromSkillMd() and BEFORE writing to disk.
 */
export async function injectInstallationTag(content: string): Promise<string> {
  const tag = await getInstallationTag();

  const match = content.match(FRONTMATTER_RE);

  if (!match) {
    // No frontmatter: create one with just the tag
    return `---\ntags:\n  - ${tag}\n---\n${content}`;
  }

  try {
    const metadata = parseYaml(match[1]);
    if (!metadata || typeof metadata !== 'object') {
      return content; // Unparseable YAML, leave as-is
    }

    // Ensure tags is an array
    if (!Array.isArray(metadata.tags)) {
      metadata.tags = [];
    }

    // Remove any existing agenshield-* tags (in case of re-install)
    metadata.tags = metadata.tags.filter(
      (t: unknown) => typeof t !== 'string' || !t.startsWith('agenshield-')
    );

    // Add our installation tag
    metadata.tags.push(tag);

    return `---\n${stringifyYaml(metadata).trimEnd()}\n---\n${match[2]}`;
  } catch {
    return content; // YAML parse failure, leave as-is
  }
}

/**
 * Extract tags from SKILL.md content.
 * Returns empty array if no tags found.
 * Synchronous — safe to call from the watcher's scanSkills().
 */
export function extractTagsFromSkillMd(content: string): string[] {
  const match = content.match(FRONTMATTER_RE);
  if (!match) return [];

  try {
    const metadata = parseYaml(match[1]);
    if (!metadata || typeof metadata !== 'object') return [];
    if (!Array.isArray(metadata.tags)) return [];
    return metadata.tags.filter((t: unknown): t is string => typeof t === 'string');
  } catch {
    return [];
  }
}
