/**
 * Skill Migration — One-time JSON → SQLite migration
 *
 * Imports data from the old JSON-file-based skill storage into SQLite.
 * Runs on startup if not already migrated.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { Storage } from '@agenshield/storage';
import { getConfigDir } from '../config/paths';

const MARKER_FILE = '.skills-migrated';

interface LegacyApprovedEntry {
  name: string;
  approvedAt: string;
  hash?: string;
  publisher?: string;
  slug?: string;
}

interface LegacyDownloadedMeta {
  name: string;
  slug: string;
  author: string;
  version: string;
  description: string;
  tags: string[];
  wasInstalled?: boolean;
  source?: string;
  analysis?: Record<string, unknown>;
}

interface LegacyAnalysisEntry {
  [skillName: string]: {
    status: string;
    vulnerability?: { level: string };
    commands?: Array<{ name: string; available: boolean }>;
    [key: string]: unknown;
  };
}

/**
 * Run the one-time migration from JSON files to SQLite.
 * Safe to call multiple times — skips if marker exists.
 */
export function migrateSkillsToSqlite(storage: Storage, skillsDir: string): void {
  const configDir = getConfigDir();
  const markerPath = path.join(configDir, MARKER_FILE);

  // Already migrated?
  if (fs.existsSync(markerPath)) {
    return;
  }

  console.log('[Migration] Starting skill data migration (JSON → SQLite)...');
  const skills = storage.skills;

  // 1. Import approved-skills.json
  const approvedPath = path.join(configDir, 'approved-skills.json');
  if (fs.existsSync(approvedPath)) {
    try {
      const approved: LegacyApprovedEntry[] = JSON.parse(
        fs.readFileSync(approvedPath, 'utf-8'),
      );

      for (const entry of approved) {
        try {
          // Check if already exists
          if (skills.getBySlug(entry.name)) continue;

          const skill = skills.create({
            name: entry.name,
            slug: entry.name,
            author: entry.publisher,
            source: 'manual',
            tags: [],
          });

          const version = skills.addVersion({
            skillId: skill.id,
            version: '0.0.0',
            folderPath: path.join(skillsDir, entry.name),
            contentHash: entry.hash ?? '',
            hashUpdatedAt: entry.approvedAt,
            approval: 'approved',
            approvedAt: entry.approvedAt,
            trusted: false,
            analysisStatus: 'pending',
            requiredBins: [],
            requiredEnv: [],
            extractedCommands: [],
          });

          // Create active installation
          skills.install({
            skillVersionId: version.id,
            status: 'active',
            autoUpdate: true,
          });

          // Register files from disk
          registerFilesFromDisk(skills, version.id, path.join(skillsDir, entry.name));
        } catch (err) {
          console.warn(`[Migration] Failed to import approved skill ${entry.name}: ${(err as Error).message}`);
        }
      }

      console.log(`[Migration] Imported ${approved.length} approved skills`);
    } catch (err) {
      console.warn(`[Migration] Failed to read approved-skills.json: ${(err as Error).message}`);
    }
  }

  // 2. Import marketplace cache
  const marketplaceDir = path.join(configDir, 'marketplace');
  if (fs.existsSync(marketplaceDir)) {
    try {
      const entries = fs.readdirSync(marketplaceDir, { withFileTypes: true });
      let importedCount = 0;

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const metaPath = path.join(marketplaceDir, entry.name, 'metadata.json');
        if (!fs.existsSync(metaPath)) continue;

        try {
          const meta: LegacyDownloadedMeta = JSON.parse(
            fs.readFileSync(metaPath, 'utf-8'),
          );

          // Skip if already imported (from approved list)
          if (skills.getBySlug(meta.slug)) continue;

          const skill = skills.create({
            name: meta.name,
            slug: meta.slug,
            author: meta.author,
            description: meta.description,
            source: meta.source === 'watcher' ? 'watcher' : 'marketplace',
            tags: meta.tags,
          });

          const version = skills.addVersion({
            skillId: skill.id,
            version: meta.version ?? '0.0.0',
            folderPath: path.join(marketplaceDir, entry.name),
            contentHash: '',
            hashUpdatedAt: new Date().toISOString(),
            approval: 'quarantined',
            trusted: false,
            analysisStatus: meta.analysis ? 'complete' : 'pending',
            analysisJson: meta.analysis ?? undefined,
            requiredBins: [],
            requiredEnv: [],
            extractedCommands: [],
          });

          // If was previously installed, create a disabled installation
          if (meta.wasInstalled) {
            skills.install({
              skillVersionId: version.id,
              status: 'disabled',
              autoUpdate: true,
            });
          }

          // Register files from marketplace cache
          registerFilesFromDisk(skills, version.id, path.join(marketplaceDir, entry.name));
          importedCount++;
        } catch (err) {
          console.warn(`[Migration] Failed to import marketplace skill ${entry.name}: ${(err as Error).message}`);
        }
      }

      console.log(`[Migration] Imported ${importedCount} marketplace skills`);
    } catch (err) {
      console.warn(`[Migration] Failed to read marketplace dir: ${(err as Error).message}`);
    }
  }

  // 3. Import skill-analyses.json
  const analysesPath = path.join(configDir, 'skill-analyses.json');
  if (fs.existsSync(analysesPath)) {
    try {
      const analyses: LegacyAnalysisEntry = JSON.parse(
        fs.readFileSync(analysesPath, 'utf-8'),
      );

      for (const [name, analysis] of Object.entries(analyses)) {
        try {
          const skill = skills.getBySlug(name);
          if (!skill) continue;

          const version = skills.getLatestVersion(skill.id);
          if (!version) continue;

          skills.updateAnalysis(version.id, {
            status: analysis.status === 'complete' ? 'complete' : 'error',
            json: analysis,
            analyzedAt: new Date().toISOString(),
          });
        } catch {
          // Best-effort
        }
      }

      console.log(`[Migration] Imported ${Object.keys(analyses).length} skill analyses`);
    } catch (err) {
      console.warn(`[Migration] Failed to read skill-analyses.json: ${(err as Error).message}`);
    }
  }

  // 4. Write marker file and rename old files
  try {
    fs.writeFileSync(markerPath, new Date().toISOString(), 'utf-8');

    // Rename old files to .migrated
    for (const file of ['approved-skills.json', 'skill-versions.json', 'skill-analyses.json']) {
      const filePath = path.join(configDir, file);
      if (fs.existsSync(filePath)) {
        fs.renameSync(filePath, `${filePath}.migrated`);
      }
    }

    console.log('[Migration] Skill migration complete');
  } catch (err) {
    console.warn(`[Migration] Failed to write marker: ${(err as Error).message}`);
  }
}

/**
 * Register files from a directory into the DB for a given version.
 */
function registerFilesFromDisk(
  skills: import('@agenshield/storage').SkillsRepository,
  versionId: string,
  dir: string,
): void {
  if (!fs.existsSync(dir)) return;

  const files = readSkillFilesRecursive(dir);
  if (files.length === 0) return;

  skills.registerFiles({
    versionId,
    files: files.map((f) => ({
      relativePath: f.relativePath,
      fileHash: crypto.createHash('sha256').update(f.content).digest('hex'),
      sizeBytes: f.content.length,
    })),
  });
}

function readSkillFilesRecursive(
  dir: string,
  prefix = '',
): Array<{ relativePath: string; content: string }> {
  const files: Array<{ relativePath: string; content: string }> = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.name === 'metadata.json') continue; // Skip marketplace meta
      if (entry.isDirectory()) {
        files.push(...readSkillFilesRecursive(path.join(dir, entry.name), rel));
      } else {
        try {
          const content = fs.readFileSync(path.join(dir, entry.name), 'utf-8');
          files.push({ relativePath: rel, content });
        } catch {
          // Skip unreadable files
        }
      }
    }
  } catch {
    // Directory unreadable
  }
  return files;
}
