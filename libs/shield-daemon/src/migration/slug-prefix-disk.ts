/**
 * Slug-prefix disk migration
 *
 * Phase 1 (legacy): Renamed unprefixed → prefixed skill folders.
 * Phase 2 (current): Removes prefixes from disk folders, wrappers,
 *   marketplace cache, policy IDs, and brew-manifest.
 *
 * Both phases are gated by DB meta keys and run at most once.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Storage } from '@agenshield/storage';
import { META_KEYS } from '@agenshield/storage';
import { CONFIG_DIR, MARKETPLACE_DIR } from '@agenshield/ipc';
import { getConfigDir } from '../config/paths';
import { loadConfig, updateConfig } from '../config/index';
import { loadManifest, saveManifest } from '../services/brew-wrapper';
import { resolveTargetContext } from '../services/target-context';

const MARKER_FILE = '.slug-prefix-disk-migrated';
const KNOWN_PREFIXES = ['oc-', 'ch-', 'lo-', 'ag-', 'cb-'];

function stripPrefix(name: string): string | null {
  for (const prefix of KNOWN_PREFIXES) {
    if (name.startsWith(prefix) && name.length > prefix.length) {
      return name.slice(prefix.length);
    }
  }
  return null;
}

/**
 * Phase 1 — Legacy: rename unprefixed → prefixed skill folders.
 * @deprecated Kept for backward compat (runs once, then phase 2 reverses it).
 */
export function migrateSlugPrefixDisk(storage: Storage, skillsDir: string): void {
  // Already migrated? Check DB meta first, then fallback to file marker
  if (storage.getMeta(META_KEYS.SLUG_PREFIX_DISK_MIGRATED)) {
    return;
  }
  const configDir = getConfigDir();
  const markerPath = path.join(configDir, MARKER_FILE);
  if (fs.existsSync(markerPath)) {
    storage.setMeta(META_KEYS.SLUG_PREFIX_DISK_MIGRATED, new Date().toISOString());
    return;
  }

  const PREFIX_MAP: Record<string, string> = {
    mcp: 'ag-',
    registry: 'cb-',
  };

  const skills = storage.skills;
  const integrationSkills = skills.getAll({ source: 'integration' });
  let renamed = 0;

  for (const skill of integrationSkills) {
    if (!skill.remoteId) continue;

    const prefix = PREFIX_MAP[skill.remoteId];
    if (!prefix) continue;

    // The DB slug is already prefixed (from migration 004).
    // Derive the old unprefixed slug by stripping the prefix.
    if (!skill.slug.startsWith(prefix)) continue;
    const oldSlug = skill.slug.slice(prefix.length);

    const oldDir = path.join(skillsDir, oldSlug);
    const newDir = path.join(skillsDir, skill.slug);

    // Only rename if old folder exists and new one doesn't
    if (fs.existsSync(oldDir) && !fs.existsSync(newDir)) {
      try {
        fs.renameSync(oldDir, newDir);
        renamed++;
      } catch (err) {
        console.warn(`[slug-prefix-disk] Failed to rename ${oldDir} → ${newDir}: ${(err as Error).message}`);
      }
    }
  }

  if (renamed > 0) {
    console.log(`[slug-prefix-disk] Renamed ${renamed} skill folder(s)`);
  }

  // Record migration in DB meta
  try {
    storage.setMeta(META_KEYS.SLUG_PREFIX_DISK_MIGRATED, new Date().toISOString());
  } catch (err) {
    console.warn(`[slug-prefix-disk] Failed to write migration marker: ${(err as Error).message}`);
  }
}

// ─── Phase 2: Remove slug prefixes ──────────────────────────────────────────

/**
 * Phase 2 — Remove slug prefixes from disk.
 *
 * After DB migration 023 has stripped prefixes from the skills table,
 * this renames on-disk folders, wrappers, marketplace cache, policy IDs,
 * and brew-manifest entries to match.
 *
 * Safe to call multiple times — no-ops after first successful run.
 */
export function removeSlugPrefixDisk(storage: Storage, skillsDir: string): void {
  if (storage.getMeta(META_KEYS.SLUG_PREFIX_REMOVED)) {
    return;
  }

  console.log('[slug-prefix-remove] Starting filesystem slug prefix removal...');

  let ctx: { agentHome: string } | null = null;
  try {
    ctx = resolveTargetContext();
  } catch {
    // No target context — nothing to migrate on disk
    storage.setMeta(META_KEYS.SLUG_PREFIX_REMOVED, new Date().toISOString());
    return;
  }

  const { agentHome } = ctx;

  // 1. Rename skill directories (prefixed → raw)
  renamePrefixedDirs(skillsDir);

  // 2. Rename wrappers in ~/bin/
  const binDir = path.join(agentHome, 'bin');
  renamePrefixedWrappers(binDir);

  // 3. Rename marketplace cache directories + update metadata.json
  const marketplaceDir = path.join(
    process.env['HOME'] || agentHome,
    CONFIG_DIR,
    MARKETPLACE_DIR,
  );
  renamePrefixedDirs(marketplaceDir);
  updateMarketplaceMeta(marketplaceDir);

  // 4. Update policy IDs in daemon config
  updatePolicyIds();

  // 5. Update brew-manifest.json owning slug references
  updateBrewManifestSync(agentHome);

  storage.setMeta(META_KEYS.SLUG_PREFIX_REMOVED, new Date().toISOString());
  console.log('[slug-prefix-remove] Filesystem slug prefix removal complete');
}

function renamePrefixedDirs(parentDir: string): void {
  if (!fs.existsSync(parentDir)) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(parentDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const raw = stripPrefix(entry.name);
    if (!raw) continue;

    const oldPath = path.join(parentDir, entry.name);
    const newPath = path.join(parentDir, raw);

    if (fs.existsSync(newPath)) {
      console.log(`[slug-prefix-remove] Skipping ${entry.name} → ${raw} (target exists)`);
      continue;
    }

    try {
      fs.renameSync(oldPath, newPath);
      console.log(`[slug-prefix-remove] Renamed dir: ${entry.name} → ${raw}`);
    } catch (err) {
      console.warn(`[slug-prefix-remove] Failed to rename ${entry.name}: ${(err as Error).message}`);
    }
  }
}

function renamePrefixedWrappers(binDir: string): void {
  if (!fs.existsSync(binDir)) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(binDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const raw = stripPrefix(entry.name);
    if (!raw) continue;

    const oldPath = path.join(binDir, entry.name);
    const newPath = path.join(binDir, raw);

    if (fs.existsSync(newPath)) {
      // Target exists — remove old prefixed wrapper
      try {
        fs.unlinkSync(oldPath);
      } catch { /* best-effort */ }
      continue;
    }

    try {
      fs.renameSync(oldPath, newPath);
    } catch (err) {
      console.warn(`[slug-prefix-remove] Failed to rename wrapper ${entry.name}: ${(err as Error).message}`);
    }
  }
}

function updateMarketplaceMeta(marketplaceDir: string): void {
  if (!fs.existsSync(marketplaceDir)) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(marketplaceDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const metaPath = path.join(marketplaceDir, entry.name, 'metadata.json');
    if (!fs.existsSync(metaPath)) continue;

    try {
      const content = fs.readFileSync(metaPath, 'utf-8');
      const meta = JSON.parse(content) as Record<string, unknown>;
      const slug = meta.slug as string | undefined;
      if (slug) {
        const rawSlug = stripPrefix(slug);
        if (rawSlug) {
          meta.slug = rawSlug;
          fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n');
        }
      }
    } catch { /* best-effort */ }
  }
}

function updatePolicyIds(): void {
  try {
    const config = loadConfig();
    let changed = false;

    const updatedPolicies = config.policies.map((p) => {
      if (!p.id.startsWith('skill-')) return p;

      const skillSlug = p.id.slice('skill-'.length);
      const raw = stripPrefix(skillSlug);
      if (!raw) return p;

      changed = true;
      return {
        ...p,
        id: `skill-${raw}`,
        name: p.name.replace(skillSlug, raw),
        patterns: p.patterns.map((pat: string) => {
          const stripped = stripPrefix(pat);
          return stripped ?? pat;
        }),
      };
    });

    if (changed) {
      updateConfig({ policies: updatedPolicies });
    }
  } catch (err) {
    console.warn(`[slug-prefix-remove] Failed to update policy IDs: ${(err as Error).message}`);
  }
}

function updateBrewManifestSync(agentHome: string): void {
  try {
    const manifest = loadManifest(agentHome);
    let changed = false;

    for (const formula of Object.values(manifest.formulas)) {
      const updated = formula.installedBy.map((slug: string) => {
        const raw = stripPrefix(slug);
        if (raw) { changed = true; return raw; }
        return slug;
      });
      formula.installedBy = updated;
    }

    for (const binary of Object.values(manifest.binaries)) {
      const updated = binary.owningSkills.map((slug: string) => {
        const raw = stripPrefix(slug);
        if (raw) { changed = true; return raw; }
        return slug;
      });
      binary.owningSkills = updated;
    }

    if (changed) {
      // Use sync write since this runs at startup before event loop is busy
      const manifestPath = path.join(agentHome, '.agenshield', 'brew-manifest.json');
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    }
  } catch (err) {
    console.warn(`[slug-prefix-remove] Failed to update brew manifest: ${(err as Error).message}`);
  }
}
