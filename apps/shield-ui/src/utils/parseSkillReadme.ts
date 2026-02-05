/**
 * Strips YAML frontmatter (---\n...\n---) and inline metadata from skill
 * readme/content before rendering. Also removes leading headings that
 * duplicate the skill name/description already shown in the page header.
 */

const YAML_FRONTMATTER = /^-{3,}[^\S\n]*\n([\s\S]*?\n)-{3,}[^\S\n]*\n?/;
const INLINE_FRONTMATTER = /^#{0,6}\s*name:\s*.+/;

interface ReadmeMeta {
  [key: string]: string | undefined;
  name?: string;
  description?: string;
  homepage?: string;
}

/**
 * Simple YAML-like key:value parser for frontmatter blocks.
 * Handles multi-line values (indented continuation lines).
 */
function parseFrontmatterBlock(raw: string): ReadmeMeta {
  const meta: ReadmeMeta = {};
  let currentKey = '';
  let currentValue = '';

  for (const line of raw.split('\n')) {
    // New key: value pair
    const kvMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)/);
    if (kvMatch) {
      // Save previous key
      if (currentKey) {
        meta[currentKey] = currentValue.trim();
      }
      currentKey = kvMatch[1];
      currentValue = kvMatch[2];
    } else if (currentKey && (line.startsWith('  ') || line.startsWith('\t'))) {
      // Continuation line
      currentValue += '\n' + line.trim();
    }
  }
  // Save last key
  if (currentKey) {
    meta[currentKey] = currentValue.trim();
  }
  return meta;
}

export function parseSkillReadme(content: string): {
  body: string;
  meta: ReadmeMeta;
} {
  if (!content) return { body: '', meta: {} };

  // Normalize line endings
  const normalized = content.replace(/\r\n/g, '\n');

  // 1. Try standard YAML frontmatter (--- ... ---)
  const yamlMatch = normalized.match(YAML_FRONTMATTER);
  if (yamlMatch) {
    const meta = parseFrontmatterBlock(yamlMatch[1]);
    let body = normalized.slice(yamlMatch[0].length).trim();
    // Strip leading heading that duplicates the name
    body = stripDuplicateHeading(body, meta.name);
    return { body, meta };
  }

  // 2. Try inline frontmatter: first line is "## name: slug description: ..."
  const firstLine = normalized.split('\n')[0];
  if (INLINE_FRONTMATTER.test(firstLine)) {
    const meta: ReadmeMeta = {};
    const cleaned = firstLine.replace(/^#{0,6}\s*/, '');
    const keyPattern = /\b(name|description|homepage|metadata):\s*/g;
    const keys: { key: string; start: number }[] = [];
    let m;
    while ((m = keyPattern.exec(cleaned)) !== null) {
      keys.push({ key: m[1], start: m.index + m[0].length });
    }
    for (let i = 0; i < keys.length; i++) {
      const end = i + 1 < keys.length ? keys[i + 1].start - keys[i + 1].key.length - 2 : cleaned.length;
      meta[keys[i].key] = cleaned.slice(keys[i].start, end).trim();
    }
    let body = normalized.slice(firstLine.length).trim();
    body = stripDuplicateHeading(body, meta.name);
    return { body, meta };
  }

  // 3. No frontmatter detected
  return { body: normalized, meta: {} };
}

/**
 * If the body starts with a heading (# or ##) that matches the skill name,
 * strip it to avoid duplication with the page-level title.
 */
function stripDuplicateHeading(body: string, name?: string): string {
  if (!name || !body) return body;
  const headingMatch = body.match(/^#{1,3}\s+(.+)\n?/);
  if (headingMatch) {
    const headingText = headingMatch[1].trim().toLowerCase();
    const skillName = name.trim().toLowerCase();
    if (headingText === skillName || headingText.includes(skillName)) {
      return body.slice(headingMatch[0].length).trim();
    }
  }
  return body;
}
