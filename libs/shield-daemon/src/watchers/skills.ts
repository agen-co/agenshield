/**
 * Skills Watcher
 *
 * Monitors the agent's skills directory for unapproved skills.
 * Unapproved skills are moved to the local marketplace cache for analysis.
 * Also detects mismatches between openclaw.json entries and the approved list.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { parseSkillMd } from '@agenshield/sandbox';
import {
  storeDownloadedSkill,
  listDownloadedSkills,
  getDownloadedSkillMeta,
  getDownloadedSkillFiles,
  deleteDownloadedSkill,
  analyzeSkillBundle,
  updateDownloadedAnalysis,
} from '../services/marketplace';
import { setCachedAnalysis } from '../services/skill-analyzer';
import { addSkillPolicy } from '../services/skill-lifecycle';
import { emitSkillAnalyzed, emitSkillAnalysisFailed } from '../events/emitter';
import { getSystemConfigDir } from '../config/paths';
import { extractTagsFromSkillMd } from '../services/skill-tag-injector';
import { hasValidInstallationTagSync } from '../vault/installation-key';

/** Path to the approved skills configuration (dev-aware) */
function getApprovedSkillsPath(): string {
  return path.join(getSystemConfigDir(), 'approved-skills.json');
}

/** Debounce interval for rapid filesystem events (ms) */
const DEBOUNCE_MS = 500;

export interface ApprovedSkillEntry {
  name: string;
  approvedAt: string;
  hash?: string;
  publisher?: string;
  /** Marketplace slug for linking back to download cache */
  slug?: string;
}

export interface UntrustedSkillInfo {
  name: string;
  detectedAt: string;
  originalPath: string;
  reason: string;
}

interface SkillsWatcherCallbacks {
  onUntrustedDetected?: (info: { name: string; reason: string }) => void;
  onApproved?: (name: string) => void;
}

let watcher: fs.FSWatcher | null = null;
let pollingInterval: NodeJS.Timeout | null = null;
let debounceTimers: Map<string, NodeJS.Timeout> = new Map();
let skillsDir: string = '';
let callbacks: SkillsWatcherCallbacks = {};

/**
 * Load the approved skills list from disk
 */
function loadApprovedSkills(): ApprovedSkillEntry[] {
  try {
    const approvedPath = getApprovedSkillsPath();
    if (fs.existsSync(approvedPath)) {
      const content = fs.readFileSync(approvedPath, 'utf-8');
      return JSON.parse(content) as ApprovedSkillEntry[];
    }
  } catch {
    // File might not exist yet
  }
  return [];
}

/**
 * Save the approved skills list to disk
 */
function saveApprovedSkills(skills: ApprovedSkillEntry[]): void {
  try {
    const approvedPath = getApprovedSkillsPath();
    const dir = path.dirname(approvedPath);
    fs.mkdirSync(dir, { recursive: true });
    const content = JSON.stringify(skills, null, 2);
    fs.writeFileSync(approvedPath, content, 'utf-8');
  } catch (err) {
    console.error('Failed to save approved skills:', (err as Error).message);
  }
}

/**
 * Check if a skill is approved
 */
function isApproved(skillName: string): boolean {
  const approved = loadApprovedSkills();
  return approved.some((s) => s.name === skillName);
}

/**
 * Normalize a skill name into a slug for marketplace storage.
 */
function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
}

/**
 * Guess a basic MIME content type from file extension.
 */
function guessContentType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const map: Record<string, string> = {
    '.md': 'text/markdown', '.json': 'application/json',
    '.yaml': 'text/yaml', '.yml': 'text/yaml', '.toml': 'text/toml',
    '.ts': 'text/typescript', '.tsx': 'text/typescript',
    '.js': 'text/javascript', '.jsx': 'text/javascript',
    '.py': 'text/x-python', '.sh': 'text/x-shellscript',
    '.txt': 'text/plain', '.env': 'text/plain', '.ini': 'text/plain',
  };
  return map[ext] ?? 'text/plain';
}

/**
 * Recursively read all text files from a directory into memory.
 */
function readSkillFiles(dir: string, prefix = ''): Array<{ name: string; type: string; content: string }> {
  const files: Array<{ name: string; type: string; content: string }> = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        files.push(...readSkillFiles(path.join(dir, entry.name), rel));
      } else {
        try {
          const content = fs.readFileSync(path.join(dir, entry.name), 'utf-8');
          files.push({ name: rel, type: guessContentType(entry.name), content });
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

/**
 * Move an unapproved skill from the skills directory to the marketplace cache.
 * Returns the slug on success, null on failure.
 */
function moveToMarketplace(skillName: string, skillPath: string): string | null {
  try {
    const files = readSkillFiles(skillPath);
    if (files.length === 0) {
      console.warn(`[SkillsWatcher] No files found in ${skillPath}, skipping`);
      return null;
    }

    // Extract metadata from SKILL.md if present
    const skillMd = files.find((f) => /skill\.md/i.test(f.name));
    let description = '';
    let version = '0.0.0';
    let author = 'unknown';
    if (skillMd) {
      try {
        const parsed = parseSkillMd(skillMd.content);
        const meta = parsed?.metadata as Record<string, string> | undefined;
        description = meta?.description ?? '';
        version = meta?.version ?? '0.0.0';
        author = meta?.author ?? 'unknown';
      } catch { /* best-effort */ }
    }

    const slug = slugify(skillName);

    storeDownloadedSkill(slug, {
      name: skillName,
      slug,
      author,
      version,
      description,
      tags: [],
      source: 'watcher',
    }, files);

    // Remove from active skills directory
    fs.rmSync(skillPath, { recursive: true, force: true });

    console.log(`[SkillsWatcher] Moved untrusted skill to marketplace cache: ${skillName}`);
    return slug;
  } catch (err) {
    console.error(`[SkillsWatcher] Failed to move ${skillName} to marketplace:`, (err as Error).message);
    return null;
  }
}

/**
 * Auto-analyze a skill that was moved to marketplace cache (runs in background).
 */
function autoAnalyze(skillName: string, slug: string): void {
  setImmediate(async () => {
    try {
      const cachedFiles = getDownloadedSkillFiles(slug);
      if (cachedFiles.length === 0) return;

      const result = await analyzeSkillBundle(cachedFiles, skillName);
      const a = result.analysis;

      setCachedAnalysis(slug, {
        status: a.status === 'complete' ? 'complete' : 'error',
        analyzerId: 'agenshield',
        commands: a.commands?.map((c) => ({
          name: c.name,
          source: c.source as 'metadata' | 'analysis',
          available: c.available,
          required: c.required,
        })) ?? [],
        vulnerability: a.vulnerability,
        envVariables: a.envVariables,
        runtimeRequirements: a.runtimeRequirements,
        installationSteps: a.installationSteps,
        runCommands: a.runCommands,
        securityFindings: a.securityFindings,
        mcpSpecificRisks: a.mcpSpecificRisks,
        error: a.status === 'error' ? 'Analysis returned error' : undefined,
      });

      updateDownloadedAnalysis(slug, a);
      emitSkillAnalyzed(slug, a);
      console.log(`[SkillsWatcher] Auto-analysis complete for: ${skillName}`);
    } catch (err) {
      console.warn(`[SkillsWatcher] Auto-analysis failed for ${skillName}:`, (err as Error).message);
      emitSkillAnalysisFailed(slug, (err as Error).message);
    }
  });
}

/* ------------------------------------------------------------------ */
/*  Hash-based integrity checking                                      */
/* ------------------------------------------------------------------ */

/** Cache of the latest mtime per skill directory (performance optimization) */
const mtimeCache = new Map<string, number>();

/**
 * Get the latest mtime of any file in a directory tree (recursive).
 * Returns 0 if directory doesn't exist or is unreadable.
 */
function getDirMtime(dir: string): number {
  let latest = 0;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        latest = Math.max(latest, getDirMtime(fullPath));
      } else {
        try {
          const stat = fs.statSync(fullPath);
          latest = Math.max(latest, stat.mtimeMs);
        } catch { /* skip unreadable */ }
      }
    }
  } catch { /* directory unreadable */ }
  return latest;
}

/**
 * Compute a SHA-256 hash of all files in a skill directory.
 * Files are sorted by relative path so the hash is deterministic.
 * Returns null if the directory doesn't exist or has no files.
 */
export function computeSkillHash(skillDir: string): string | null {
  const files = readSkillFiles(skillDir);
  if (files.length === 0) return null;

  // Sort by name for deterministic hash
  files.sort((a, b) => a.name.localeCompare(b.name));

  const hash = crypto.createHash('sha256');
  for (const file of files) {
    hash.update(file.name);
    hash.update(file.content);
  }
  return hash.digest('hex');
}

/**
 * Update the hash for an approved skill in approved-skills.json.
 */
export function updateApprovedHash(skillName: string, hash: string): void {
  const approved = loadApprovedSkills();
  const entry = approved.find((s) => s.name === skillName);
  if (entry) {
    entry.hash = hash;
    saveApprovedSkills(approved);
  }
}

/**
 * Scan the skills directory for unapproved skills and detect mismatches.
 */
function scanSkills(): void {
  if (!skillsDir || !fs.existsSync(skillsDir)) {
    return;
  }

  try {
    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    const approved = loadApprovedSkills();
    const approvedMap = new Map(approved.map((a) => [a.name, a]));

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillName = entry.name;
      const approvedEntry = approvedMap.get(skillName);

      if (!approvedEntry) {
        // Not in approved list — check for valid installation tag before quarantining
        const fullPath = path.join(skillsDir, skillName);
        let autoApproved = false;

        // Look for SKILL.md with a valid agenshield-{key} tag
        for (const mdName of ['SKILL.md', 'skill.md']) {
          const mdPath = path.join(fullPath, mdName);
          try {
            if (fs.existsSync(mdPath)) {
              const content = fs.readFileSync(mdPath, 'utf-8');
              const tags = extractTagsFromSkillMd(content);
              if (hasValidInstallationTagSync(tags)) {
                // Auto-approve: installed by this AgenShield instance
                console.log(`[SkillsWatcher] Auto-approving skill with valid installation tag: ${skillName}`);
                const hash = computeSkillHash(fullPath);
                addToApprovedList(skillName, undefined, hash ?? undefined);
                addSkillPolicy(skillName);
                if (callbacks.onApproved) {
                  callbacks.onApproved(skillName);
                }
                autoApproved = true;
                break;
              }
            }
          } catch {
            // Couldn't read SKILL.md, continue to quarantine
          }
        }

        if (!autoApproved) {
          // No valid tag → move to marketplace as untrusted
          const slug = moveToMarketplace(skillName, fullPath);
          if (slug) {
            if (callbacks.onUntrustedDetected) {
              callbacks.onUntrustedDetected({ name: skillName, reason: 'Skill not in approved list' });
            }
          }
        }
      } else if (approvedEntry.hash) {
        // Approved WITH hash → integrity check (mtime-gated for performance)
        const fullPath = path.join(skillsDir, skillName);
        const currentMtime = getDirMtime(fullPath);
        const cachedMtime = mtimeCache.get(skillName) ?? 0;

        if (currentMtime !== cachedMtime) {
          mtimeCache.set(skillName, currentMtime);
          const currentHash = computeSkillHash(fullPath);
          if (currentHash && currentHash !== approvedEntry.hash) {
            console.warn(`[SkillsWatcher] Integrity mismatch for approved skill: ${skillName}`);
            // Remove from approved list FIRST
            removeFromApprovedList(skillName);
            // Move to marketplace as untrusted
            const slug = moveToMarketplace(skillName, fullPath);
            if (slug) {
              if (callbacks.onUntrustedDetected) {
                callbacks.onUntrustedDetected({ name: skillName, reason: 'Skill files modified externally' });
              }
            }
          }
        }
      }
      // Approved WITHOUT hash → skip (legacy entry, no baseline)
    }
  } catch (err) {
    console.error('[SkillsWatcher] Scan error:', (err as Error).message);
  }
}

/**
 * Handle a filesystem event with debouncing
 */
function handleFsEvent(eventType: string, filename: string | null): void {
  if (!filename) return;

  // Debounce per skill name
  const existing = debounceTimers.get(filename);
  if (existing) {
    clearTimeout(existing);
  }

  debounceTimers.set(
    filename,
    setTimeout(() => {
      debounceTimers.delete(filename);
      scanSkills();
    }, DEBOUNCE_MS)
  );
}

/**
 * Start the skills watcher
 *
 * @param watchDir - The skills directory to watch (e.g., $HOME/.openclaw/skills)
 * @param cbs - Callbacks for untrusted/approve events
 * @param pollIntervalMs - Polling fallback interval (default: 30 seconds)
 */
export function startSkillsWatcher(
  watchDir: string,
  cbs: SkillsWatcherCallbacks = {},
  pollIntervalMs = 30000
): void {
  if (watcher || pollingInterval) {
    return; // Already running
  }

  skillsDir = watchDir;
  callbacks = cbs;

  // Initial scan
  scanSkills();

  // Try fs.watch first
  try {
    if (fs.existsSync(skillsDir)) {
      watcher = fs.watch(skillsDir, { persistent: false }, handleFsEvent);
      watcher.on('error', (err) => {
        console.warn('[SkillsWatcher] fs.watch error, falling back to polling:', err.message);
        watcher?.close();
        watcher = null;
        // Fall back to polling
        if (!pollingInterval) {
          pollingInterval = setInterval(scanSkills, pollIntervalMs);
        }
      });
    }
  } catch {
    // fs.watch not available
  }

  // Polling fallback (also catches new directory creation)
  pollingInterval = setInterval(scanSkills, pollIntervalMs);

  console.log(`[SkillsWatcher] Started watching ${watchDir} (poll: ${pollIntervalMs}ms)`);
}

/**
 * Stop the skills watcher
 */
export function stopSkillsWatcher(): void {
  if (watcher) {
    watcher.close();
    watcher = null;
  }

  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }

  for (const timer of debounceTimers.values()) {
    clearTimeout(timer);
  }
  debounceTimers.clear();

  console.log('[SkillsWatcher] Stopped');
}

/**
 * Approve a skill — add to approved list.
 * The actual file installation from marketplace cache is handled by the toggle/install routes.
 */
export function approveSkill(skillName: string): { success: boolean; error?: string } {
  try {
    const slug = slugify(skillName);
    const meta = getDownloadedSkillMeta(slug);
    if (!meta) {
      return { success: false, error: `Skill "${skillName}" not found in marketplace cache` };
    }

    // Compute hash from marketplace cache files for integrity baseline
    const cachedFiles = getDownloadedSkillFiles(slug);
    let hash: string | undefined;
    if (cachedFiles.length > 0) {
      // Create a temporary hash from the cached files
      const h = crypto.createHash('sha256');
      const sorted = [...cachedFiles].sort((a, b) => a.name.localeCompare(b.name));
      for (const file of sorted) {
        h.update(file.name);
        h.update(file.content);
      }
      hash = h.digest('hex');
    }

    // Add to approved list
    const approved = loadApprovedSkills();
    if (!approved.some((s) => s.name === skillName)) {
      approved.push({
        name: skillName,
        approvedAt: new Date().toISOString(),
        publisher: meta.author,
        ...(hash ? { hash } : {}),
      });
      saveApprovedSkills(approved);
    }

    if (callbacks.onApproved) {
      callbacks.onApproved(skillName);
    }

    console.log(`[SkillsWatcher] Approved skill: ${skillName}`);
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Reject an untrusted skill (permanently delete from marketplace cache)
 */
export function rejectSkill(skillName: string): { success: boolean; error?: string } {
  try {
    const slug = slugify(skillName);
    deleteDownloadedSkill(slug);

    console.log(`[SkillsWatcher] Rejected and deleted skill: ${skillName}`);
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Revoke an approved skill (remove from approved list and move to marketplace cache)
 */
export function revokeSkill(skillName: string): { success: boolean; error?: string } {
  try {
    // Remove from approved list
    const approved = loadApprovedSkills();
    const filtered = approved.filter((s) => s.name !== skillName);
    saveApprovedSkills(filtered);

    // If the skill is in the skills directory, move it to marketplace cache
    const skillPath = path.join(skillsDir, skillName);
    if (fs.existsSync(skillPath)) {
      moveToMarketplace(skillName, skillPath);
    }

    console.log(`[SkillsWatcher] Revoked approval for skill: ${skillName}`);
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * List untrusted skills: skills in the marketplace cache that are NOT approved.
 */
export function listUntrusted(): UntrustedSkillInfo[] {
  const approved = loadApprovedSkills();
  const approvedNames = new Set(approved.map((a) => a.name));

  const downloaded = listDownloadedSkills();
  return downloaded
    .filter((d) => !approvedNames.has(d.slug) && !approvedNames.has(d.name))
    // Only show skills detected by the watcher — marketplace previews are not untrusted
    .filter((d) => d.source === 'watcher')
    .map((d) => ({
      name: d.slug,
      detectedAt: '',
      originalPath: skillsDir ? path.join(skillsDir, d.slug) : '',
      reason: 'Skill not in approved list',
    }));
}

/**
 * List approved skills
 */
export function listApproved(): ApprovedSkillEntry[] {
  return loadApprovedSkills();
}

/**
 * Force an immediate skill scan
 */
export function triggerSkillsScan(): void {
  scanSkills();
}

/**
 * Get the configured skills directory path
 */
export function getSkillsDir(): string {
  return skillsDir;
}

/**
 * Add a skill to the approved list without requiring quarantine.
 * Used by marketplace install to pre-approve before writing files,
 * preventing a race condition with the watcher quarantining new skills.
 */
export function addToApprovedList(skillName: string, publisher?: string, hash?: string, slug?: string): void {
  const approved = loadApprovedSkills();
  if (!approved.some((s) => s.name === skillName)) {
    approved.push({
      name: skillName,
      approvedAt: new Date().toISOString(),
      ...(publisher ? { publisher } : {}),
      ...(hash ? { hash } : {}),
      ...(slug ? { slug } : {}),
    });
    saveApprovedSkills(approved);
  }
}

/**
 * Remove a skill from the approved list (without quarantining).
 * Used for cleanup when marketplace install fails after pre-approval.
 */
export function removeFromApprovedList(skillName: string): void {
  const approved = loadApprovedSkills();
  const filtered = approved.filter((s) => s.name !== skillName);
  if (filtered.length !== approved.length) {
    saveApprovedSkills(filtered);
  }
}
