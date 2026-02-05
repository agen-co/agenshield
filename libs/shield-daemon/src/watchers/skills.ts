/**
 * Skills Watcher
 *
 * Monitors the agent's skills directory for unapproved skills.
 * Unapproved skills are moved to a quarantine directory.
 * Follows the pattern of the existing security watcher.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

/** Path to the approved skills configuration */
const APPROVED_SKILLS_PATH = '/opt/agenshield/config/approved-skills.json';

/** Quarantine directory for unapproved skills */
const QUARANTINE_DIR = '/opt/agenshield/quarantine/skills';

/** Debounce interval for rapid filesystem events (ms) */
const DEBOUNCE_MS = 500;

export interface ApprovedSkillEntry {
  name: string;
  approvedAt: string;
  hash?: string;
  publisher?: string;
}

export interface QuarantinedSkillInfo {
  name: string;
  quarantinedAt: string;
  originalPath: string;
  reason: string;
}

interface SkillsWatcherCallbacks {
  onQuarantined?: (info: QuarantinedSkillInfo) => void;
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
    if (fs.existsSync(APPROVED_SKILLS_PATH)) {
      const content = fs.readFileSync(APPROVED_SKILLS_PATH, 'utf-8');
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
    const dir = path.dirname(APPROVED_SKILLS_PATH);
    if (!fs.existsSync(dir)) {
      execSync(`sudo mkdir -p "${dir}"`, { stdio: 'pipe' });
    }
    // Write atomically via sudo (config dir is root-owned)
    const content = JSON.stringify(skills, null, 2);
    execSync(`sudo tee "${APPROVED_SKILLS_PATH}" > /dev/null << 'APPROVEDEOF'
${content}
APPROVEDEOF`, { stdio: 'pipe' });
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
 * Move an unapproved skill to quarantine
 */
function quarantineSkill(skillName: string, skillPath: string): QuarantinedSkillInfo | null {
  try {
    const quarantinePath = path.join(QUARANTINE_DIR, skillName);

    // Ensure quarantine dir exists
    if (!fs.existsSync(QUARANTINE_DIR)) {
      execSync(`sudo mkdir -p "${QUARANTINE_DIR}"`, { stdio: 'pipe' });
      execSync(`sudo chmod 700 "${QUARANTINE_DIR}"`, { stdio: 'pipe' });
    }

    // Remove existing quarantined version if present
    if (fs.existsSync(quarantinePath)) {
      execSync(`sudo rm -rf "${quarantinePath}"`, { stdio: 'pipe' });
    }

    // Move skill to quarantine (requires root since source may be root-owned)
    execSync(`sudo mv "${skillPath}" "${quarantinePath}"`, { stdio: 'pipe' });
    execSync(`sudo chown -R root:wheel "${quarantinePath}"`, { stdio: 'pipe' });
    execSync(`sudo chmod -R 700 "${quarantinePath}"`, { stdio: 'pipe' });

    const info: QuarantinedSkillInfo = {
      name: skillName,
      quarantinedAt: new Date().toISOString(),
      originalPath: skillPath,
      reason: 'Skill not in approved list',
    };

    console.log(`[SkillsWatcher] Quarantined unapproved skill: ${skillName}`);
    return info;
  } catch (err) {
    console.error(`[SkillsWatcher] Failed to quarantine ${skillName}:`, (err as Error).message);
    return null;
  }
}

/**
 * Scan the skills directory for unapproved skills
 */
function scanSkills(): void {
  if (!skillsDir || !fs.existsSync(skillsDir)) {
    return;
  }

  try {
    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillName = entry.name;
      if (!isApproved(skillName)) {
        const fullPath = path.join(skillsDir, skillName);
        const info = quarantineSkill(skillName, fullPath);
        if (info && callbacks.onQuarantined) {
          callbacks.onQuarantined(info);
        }
      }
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
 * @param cbs - Callbacks for quarantine/approve events
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
 * Approve a skill (move from quarantine back to skills directory)
 */
export function approveSkill(skillName: string): { success: boolean; error?: string } {
  try {
    const quarantinedPath = path.join(QUARANTINE_DIR, skillName);
    const destPath = path.join(skillsDir, skillName);

    if (!fs.existsSync(quarantinedPath)) {
      return { success: false, error: `Skill "${skillName}" not found in quarantine` };
    }

    // Add to approved list
    const approved = loadApprovedSkills();
    if (!approved.some((s) => s.name === skillName)) {
      approved.push({
        name: skillName,
        approvedAt: new Date().toISOString(),
      });
      saveApprovedSkills(approved);
    }

    // Move from quarantine back to skills directory
    execSync(`sudo mv "${quarantinedPath}" "${destPath}"`, { stdio: 'pipe' });

    // Set proper ownership (root-owned, group-readable)
    execSync(`sudo chown -R root:wheel "${destPath}"`, { stdio: 'pipe' });
    execSync(`sudo chmod -R a+rX,go-w "${destPath}"`, { stdio: 'pipe' });

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
 * Reject a quarantined skill (permanently delete)
 */
export function rejectSkill(skillName: string): { success: boolean; error?: string } {
  try {
    const quarantinedPath = path.join(QUARANTINE_DIR, skillName);

    if (!fs.existsSync(quarantinedPath)) {
      return { success: false, error: `Skill "${skillName}" not found in quarantine` };
    }

    execSync(`sudo rm -rf "${quarantinedPath}"`, { stdio: 'pipe' });

    console.log(`[SkillsWatcher] Rejected and deleted skill: ${skillName}`);
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Revoke an approved skill (remove from approved list and quarantine)
 */
export function revokeSkill(skillName: string): { success: boolean; error?: string } {
  try {
    // Remove from approved list
    const approved = loadApprovedSkills();
    const filtered = approved.filter((s) => s.name !== skillName);
    saveApprovedSkills(filtered);

    // If the skill is in the skills directory, quarantine it
    const skillPath = path.join(skillsDir, skillName);
    if (fs.existsSync(skillPath)) {
      quarantineSkill(skillName, skillPath);
    }

    console.log(`[SkillsWatcher] Revoked approval for skill: ${skillName}`);
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * List quarantined skills
 */
export function listQuarantined(): QuarantinedSkillInfo[] {
  const results: QuarantinedSkillInfo[] = [];

  try {
    if (!fs.existsSync(QUARANTINE_DIR)) {
      return results;
    }

    const entries = fs.readdirSync(QUARANTINE_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const stat = fs.statSync(path.join(QUARANTINE_DIR, entry.name));
        results.push({
          name: entry.name,
          quarantinedAt: stat.mtime.toISOString(),
          originalPath: path.join(skillsDir, entry.name),
          reason: 'Skill not in approved list',
        });
      }
    }
  } catch {
    // Quarantine dir might not exist
  }

  return results;
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
export function addToApprovedList(skillName: string, publisher?: string): void {
  const approved = loadApprovedSkills();
  if (!approved.some((s) => s.name === skillName)) {
    approved.push({
      name: skillName,
      approvedAt: new Date().toISOString(),
      ...(publisher ? { publisher } : {}),
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
