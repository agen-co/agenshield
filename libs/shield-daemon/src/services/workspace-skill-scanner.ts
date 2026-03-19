/**
 * Workspace Skill Scanner
 *
 * Monitors active workspaces for `.claude/skills/` directories.
 * Unapproved skills get ACL deny entries to block agent access.
 * Approved skills are backed up and integrity-checked on each scan.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { WorkspaceSkill, WorkspaceSkillStatus } from '@agenshield/ipc';
import type { Storage } from '@agenshield/storage';
import { denyWorkspaceSkill, allowWorkspaceSkill } from '../acl';
import { getWorkspaceSkillBackupDir, getCloudSkillsDir } from '../config/paths';
import { eventBus } from '../events/emitter';

/** Directories to skip when walking for nested .claude/skills/ dirs. */
const NESTED_SKIP_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', 'vendor', '__pycache__',
  '.tox', '.venv', 'venv', 'dist', 'build', '.next', '.cache',
  '.gradle', 'target', '.terraform', '.cargo', 'Pods', '.eggs',
  'bower_components',
]);

interface Logger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  debug(msg: string, ...args: unknown[]): void;
}

interface ScannerDeps {
  storage: Storage;
  logger: Logger;
  configDir: string;
}

/**
 * Read all files from a skill directory recursively (skips dot-files).
 */
export function readSkillFiles(dir: string, prefix = ''): Array<{ name: string; content: string }> {
  const files: Array<{ name: string; content: string }> = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        files.push(...readSkillFiles(path.join(dir, entry.name), rel));
      } else {
        try {
          const content = fs.readFileSync(path.join(dir, entry.name), 'utf-8');
          files.push({ name: rel, content });
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
 * Compute deterministic SHA-256 hash of a skill directory's contents.
 */
function computeSkillHash(skillDir: string): string | null {
  const files = readSkillFiles(skillDir);
  if (files.length === 0) return null;

  files.sort((a, b) => a.name.localeCompare(b.name));

  const hash = crypto.createHash('sha256');
  for (const file of files) {
    hash.update(file.name);
    hash.update(file.content);
  }
  return hash.digest('hex');
}

/**
 * Copy a skill directory to the backup location.
 */
function backupSkill(skillDir: string, backupDir: string): string | null {
  try {
    fs.mkdirSync(backupDir, { recursive: true });
    const files = readSkillFiles(skillDir);
    for (const file of files) {
      const dest = path.join(backupDir, file.name);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, file.content, 'utf-8');
    }
    return computeSkillHash(backupDir);
  } catch {
    return null;
  }
}

/**
 * Get backup directory for a specific workspace skill.
 */
function getSkillBackupPath(workspacePath: string, skillName: string): string {
  const key = `${workspacePath}:${skillName}`;
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  return path.join(getWorkspaceSkillBackupDir(), hash);
}

// Singleton for cross-module access (e.g. from cloud-connector)
let scannerSingleton: WorkspaceSkillScanner | null = null;
export function setWorkspaceSkillScanner(s: WorkspaceSkillScanner): void { scannerSingleton = s; }
export function getWorkspaceSkillScanner(): WorkspaceSkillScanner | null { return scannerSingleton; }

export class WorkspaceSkillScanner {
  private storage: Storage;
  private logger: Logger;
  private pollTimer: NodeJS.Timeout | null = null;
  private watchers: Map<string, fs.FSWatcher> = new Map();
  private scanDebounceTimers = new Map<string, NodeJS.Timeout>();
  private stopped = false;

  constructor(deps: ScannerDeps) {
    this.storage = deps.storage;
    this.logger = deps.logger;
  }

  /**
   * Resolve the agent username for a profile.
   * Returns empty string if the profile doesn't exist or has no agent user.
   */
  private resolveAgentUsername(profileId: string): string {
    const profile = this.storage.profiles.getById(profileId);
    const username = (profile as { agentUsername?: string } | null)?.agentUsername ?? '';
    if (!username) {
      this.logger.warn(`[workspace-skills] no agentUsername for profile ${profileId}, cannot apply ACL`);
    }
    return username;
  }

  /**
   * Scan one workspace for skills. Called on grant and periodic re-scan.
   */
  scanWorkspace(profileId: string, workspacePath: string): WorkspaceSkill[] {
    const skillsDir = path.join(workspacePath, '.claude', 'skills');
    const results: WorkspaceSkill[] = [];

    if (!fs.existsSync(skillsDir)) {
      // Clean up any stale DB records for this workspace
      const dbSkills = this.storage.workspaceSkills.getByWorkspace(workspacePath);
      for (const skill of dbSkills) {
        if (skill.status !== 'removed') {
          this.storage.workspaceSkills.markRemoved(skill.id);
          eventBus.emit('workspace_skills:removed', { workspacePath, skillName: skill.skillName });
          this.logger.info(`[workspace-skills] skill removed (skills dir gone): ${skill.skillName} in ${workspacePath}`);
        }
      }
      return results;
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    } catch {
      this.logger.warn(`[workspace-skills] cannot read ${skillsDir}`);
      return results;
    }

    const agentUsername = this.resolveAgentUsername(profileId);
    const foundNames = new Set<string>();

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;

      const skillName = entry.name;
      foundNames.add(skillName);
      const skillPath = path.join(skillsDir, skillName);

      const existing = this.storage.workspaceSkills.getByKey(workspacePath, skillName);

      if (!existing) {
        // New skill — check SHA256 against approved hashes first
        const contentHash = computeSkillHash(skillPath);

        // SHA256-only enforcement: matching hash = auto-approve
        const hashApproved = contentHash && this.storage.approvedSkillHashes.isApproved(contentHash);

        if (hashApproved) {
          // Auto-approve: hash matches cloud-approved list
          const backupDir = getSkillBackupPath(workspacePath, skillName);
          const backupHash = backupSkill(skillPath, backupDir);

          const created = this.storage.workspaceSkills.create({
            profileId,
            workspacePath,
            skillName,
            status: 'approved',
            contentHash: contentHash ?? undefined,
            approvedBy: 'cloud:sha256',
            approvedAt: new Date().toISOString(),
            aclApplied: false,
          });

          // Set backup hash via update (not in create schema)
          if (backupHash && created) {
            this.storage.workspaceSkills.update(created.id, { backupHash });
          }

          eventBus.emit('workspace_skills:approved', {
            workspacePath,
            skillName,
            approvedBy: 'cloud:sha256',
          });

          results.push(created);
          this.logger.info(`[workspace-skills] auto-approved (SHA256 match): ${skillName} in ${workspacePath}`);
        } else {
          // No hash match — pending, apply deny ACL
          const aclApplied = agentUsername
            ? denyWorkspaceSkill(skillPath, agentUsername, this.logger)
            : false;

          const created = this.storage.workspaceSkills.create({
            profileId,
            workspacePath,
            skillName,
            status: 'pending',
            contentHash: contentHash ?? undefined,
            aclApplied,
          });

          eventBus.emit('workspace_skills:detected', {
            workspacePath,
            skillName,
            status: 'pending',
          });

          results.push(created);
          this.logger.info(`[workspace-skills] detected new skill: ${skillName} in ${workspacePath} (acl=${aclApplied})`);
        }
      } else if (existing.status === 'removed') {
        // Previously removed — don't re-add
        results.push(existing);
      } else if (existing.status === 'approved') {
        // Check for tampering
        const currentHash = computeSkillHash(skillPath);
        if (currentHash && existing.contentHash && currentHash !== existing.contentHash) {
          // Tampered — revert to pending
          const aclApplied = agentUsername
            ? denyWorkspaceSkill(skillPath, agentUsername, this.logger)
            : false;

          this.storage.workspaceSkills.update(existing.id, {
            status: 'pending',
            contentHash: currentHash,
            aclApplied,
            cloudSkillId: null,
          });

          eventBus.emit('workspace_skills:tampered', {
            workspacePath,
            skillName,
            previousHash: existing.contentHash,
            currentHash,
          });

          this.logger.warn(`[workspace-skills] tamper detected: ${skillName} in ${workspacePath}`);
          const updated = this.storage.workspaceSkills.getById(existing.id);
          if (updated) results.push(updated);
        } else if (
          existing.approvedBy?.startsWith('cloud') &&
          currentHash &&
          !this.storage.approvedSkillHashes.isApproved(currentHash)
        ) {
          // Cloud approval revoked — re-quarantine
          const aclApplied = agentUsername
            ? denyWorkspaceSkill(skillPath, agentUsername, this.logger)
            : false;

          this.storage.workspaceSkills.update(existing.id, {
            status: 'pending',
            aclApplied,
            cloudSkillId: null,
            approvedBy: null,
            approvedAt: null,
          });

          eventBus.emit('workspace_skills:revoked', {
            workspacePath,
            skillName,
            previousApprovedBy: existing.approvedBy,
          });

          this.logger.warn(`[workspace-skills] cloud approval revoked: ${skillName} in ${workspacePath}`);
          const updated = this.storage.workspaceSkills.getById(existing.id);
          if (updated) results.push(updated);
        } else {
          results.push(existing);
        }
      } else if (existing.status === 'cloud_forced') {
        // Verify integrity, restore from cloud skills dir if tampered
        const currentHash = computeSkillHash(skillPath);
        if (currentHash && existing.contentHash && currentHash !== existing.contentHash) {
          this.restoreCloudForcedSkill(skillName, skillPath);
          this.logger.warn(`[workspace-skills] restored cloud_forced skill: ${skillName}`);
        }
        results.push(existing);
      } else {
        // pending or denied — re-check hash against approved list
        const currentHash = computeSkillHash(skillPath);
        if (currentHash && this.storage.approvedSkillHashes.isApproved(currentHash)) {
          this.approveSkill(existing.id, 'cloud:sha256');
          const updated = this.storage.workspaceSkills.getById(existing.id);
          if (updated) results.push(updated);
          this.logger.info(`[workspace-skills] auto-approved (hash match on rescan): ${skillName} in ${workspacePath}`);
        } else {
          if (!existing.aclApplied && agentUsername) {
            denyWorkspaceSkill(skillPath, agentUsername, this.logger);
            this.storage.workspaceSkills.update(existing.id, { aclApplied: true });
          }
          results.push(existing);
        }
      }
    }

    // Mark skills in DB but missing from disk as removed
    const dbSkills = this.storage.workspaceSkills.getByWorkspace(workspacePath);
    for (const dbSkill of dbSkills) {
      if (dbSkill.status === 'removed') continue;
      if (!foundNames.has(dbSkill.skillName)) {
        this.storage.workspaceSkills.markRemoved(dbSkill.id);

        eventBus.emit('workspace_skills:removed', {
          workspacePath,
          skillName: dbSkill.skillName,
        });

        this.logger.info(`[workspace-skills] skill removed from disk: ${dbSkill.skillName} in ${workspacePath}`);
      }
    }

    return results;
  }

  /**
   * Scan all workspaces from all profiles.
   */
  scanAllWorkspaces(): void {
    const profiles = this.storage.profiles.getAll();
    for (const profile of profiles) {
      const workspacePaths = (profile as { workspacePaths?: string[] }).workspacePaths ?? [];
      for (const ws of workspacePaths) {
        if (!fs.existsSync(ws)) {
          // Workspace path no longer exists — mark all its skills as removed
          const skills = this.storage.workspaceSkills.getByWorkspace(ws);
          for (const skill of skills) {
            if (skill.status !== 'removed') {
              this.storage.workspaceSkills.markRemoved(skill.id);
            }
          }
          // Also clean up nested workspace skills
          const nestedSkills = this.storage.workspaceSkills.getByWorkspacePrefix(ws + '/');
          for (const skill of nestedSkills) {
            if (skill.status !== 'removed') {
              this.storage.workspaceSkills.markRemoved(skill.id);
            }
          }
          continue;
        }

        // Scan root workspace
        this.scanWorkspace(profile.id, ws);

        // Discover and scan nested workspaces
        const nested = this.discoverNestedSkillsDirs(ws);
        const nestedSet = new Set(nested);
        for (const nestedPath of nested) {
          this.scanWorkspace(profile.id, nestedPath);
          this.watchWorkspaceSkillsDir(profile.id, nestedPath);
        }

        // Clean up stale nested workspaces (in DB but no longer discovered)
        const nestedDbSkills = this.storage.workspaceSkills.getByWorkspacePrefix(ws + '/');
        for (const skill of nestedDbSkills) {
          if (skill.status !== 'removed' && !nestedSet.has(skill.workspacePath)) {
            // This nested workspace no longer has .claude/skills/ — scanWorkspace will clean up
            this.scanWorkspace(profile.id, skill.workspacePath);
          }
        }
      }
    }
  }

  /**
   * Start periodic scanning and set up fs.watch for real-time detection.
   */
  start(pollIntervalMs = 30_000): void {
    this.stopped = false;

    // Initial scan
    try {
      this.scanAllWorkspaces();
    } catch (err) {
      this.logger.error(`[workspace-skills] initial scan failed: ${(err as Error).message}`);
    }

    // Set up fs.watch on each workspace's .claude/skills/ directory
    this.setupWatchers();

    // Periodic poll (fallback for missed fs.watch events)
    this.pollTimer = setInterval(() => {
      if (this.stopped) return;
      try {
        this.scanAllWorkspaces();
      } catch (err) {
        this.logger.error(`[workspace-skills] periodic scan failed: ${(err as Error).message}`);
      }
    }, pollIntervalMs);

    this.logger.info(`[workspace-skills] scanner started (poll every ${pollIntervalMs}ms, fs.watch active)`);
  }

  /**
   * Stop all watchers and polling.
   */
  stop(): void {
    this.stopped = true;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    for (const [, watcher] of this.watchers) {
      watcher.close();
    }
    this.watchers.clear();
    for (const timer of this.scanDebounceTimers.values()) {
      clearTimeout(timer);
    }
    this.scanDebounceTimers.clear();
    this.logger.info('[workspace-skills] scanner stopped');
  }

  /**
   * Called when a workspace path is granted to the agent.
   * Synchronously scans and applies ACLs before returning.
   */
  onWorkspaceGranted(profileId: string, workspacePath: string): void {
    this.scanWorkspace(profileId, workspacePath);
    this.watchWorkspaceSkillsDir(profileId, workspacePath);

    // Discover and handle nested workspaces
    const nested = this.discoverNestedSkillsDirs(workspacePath);
    for (const nestedPath of nested) {
      this.scanWorkspace(profileId, nestedPath);
      this.watchWorkspaceSkillsDir(profileId, nestedPath);
    }
  }

  /**
   * Called when a workspace path is revoked.
   * Marks all skills for that workspace as removed.
   */
  onWorkspaceRevoked(workspacePath: string): void {
    // Revoke root workspace skills
    this.revokeWorkspaceSkills(workspacePath);

    // Revoke all nested workspace skills
    const nestedSkills = this.storage.workspaceSkills.getByWorkspacePrefix(workspacePath + '/');
    const revokedPaths = new Set<string>();
    for (const skill of nestedSkills) {
      revokedPaths.add(skill.workspacePath);
    }
    for (const nestedPath of revokedPaths) {
      this.revokeWorkspaceSkills(nestedPath);
    }

    // Close watchers for nested paths
    for (const [dir, watcher] of this.watchers) {
      if (dir.startsWith(workspacePath + '/')) {
        watcher.close();
        this.watchers.delete(dir);
      }
    }
  }

  /**
   * Approve a workspace skill. Creates backup and removes deny ACL.
   * Returns the updated skill record.
   */
  approveSkill(skillId: string, approvedBy: string): WorkspaceSkill | null {
    const skill = this.storage.workspaceSkills.getById(skillId);
    if (!skill) return null;

    const agentUsername = this.resolveAgentUsername(skill.profileId);
    const skillPath = path.join(skill.workspacePath, '.claude', 'skills', skill.skillName);
    const contentHash = computeSkillHash(skillPath);

    // Create backup
    const backupDir = getSkillBackupPath(skill.workspacePath, skill.skillName);
    const backupHash = backupSkill(skillPath, backupDir);

    // Update DB
    const updated = this.storage.workspaceSkills.update(skillId, {
      status: 'approved' as WorkspaceSkillStatus,
      contentHash: contentHash ?? undefined,
      backupHash: backupHash ?? undefined,
      approvedBy,
      approvedAt: new Date().toISOString(),
      aclApplied: false,
    });

    // Remove deny ACL
    if (agentUsername) {
      allowWorkspaceSkill(skillPath, agentUsername, this.logger);
    }

    eventBus.emit('workspace_skills:approved', {
      workspacePath: skill.workspacePath,
      skillName: skill.skillName,
      approvedBy,
    });

    this.logger.info(`[workspace-skills] approved: ${skill.skillName} by ${approvedBy}`);
    return updated;
  }

  /**
   * Deny a workspace skill. Ensures deny ACL is applied.
   */
  denySkill(skillId: string): WorkspaceSkill | null {
    const skill = this.storage.workspaceSkills.getById(skillId);
    if (!skill) return null;

    const agentUsername = this.resolveAgentUsername(skill.profileId);
    const skillPath = path.join(skill.workspacePath, '.claude', 'skills', skill.skillName);

    const aclApplied = agentUsername
      ? denyWorkspaceSkill(skillPath, agentUsername, this.logger)
      : false;

    const updated = this.storage.workspaceSkills.update(skillId, {
      status: 'denied' as WorkspaceSkillStatus,
      aclApplied,
    });

    eventBus.emit('workspace_skills:denied', {
      workspacePath: skill.workspacePath,
      skillName: skill.skillName,
    });

    this.logger.info(`[workspace-skills] denied: ${skill.skillName} (acl=${aclApplied})`);
    return updated;
  }

  /**
   * Push a cloud-forced skill into all active workspaces.
   */
  pushCloudForcedSkill(
    skillName: string,
    files: Array<{ name: string; content: string }>,
    cloudSkillId?: string,
  ): string[] {
    // Store in cloud skills directory
    const cloudDir = path.join(getCloudSkillsDir(), skillName);
    fs.mkdirSync(cloudDir, { recursive: true });
    for (const file of files) {
      const dest = path.join(cloudDir, file.name);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, file.content, 'utf-8');
    }
    const cloudHash = computeSkillHash(cloudDir);

    // Copy to each active workspace
    const profiles = this.storage.profiles.getAll();
    const targetWorkspaces: string[] = [];

    for (const profile of profiles) {
      const agentUsername = (profile as { agentUsername?: string }).agentUsername ?? '';
      const workspacePaths = (profile as { workspacePaths?: string[] }).workspacePaths ?? [];
      for (const ws of workspacePaths) {
        if (!fs.existsSync(ws)) continue;

        const wsSkillDir = path.join(ws, '.claude', 'skills', skillName);
        fs.mkdirSync(wsSkillDir, { recursive: true });
        for (const file of files) {
          const dest = path.join(wsSkillDir, file.name);
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.writeFileSync(dest, file.content, 'utf-8');
        }

        // Upsert DB record
        const existing = this.storage.workspaceSkills.getByKey(ws, skillName);
        if (existing) {
          this.storage.workspaceSkills.update(existing.id, {
            status: 'cloud_forced' as WorkspaceSkillStatus,
            contentHash: cloudHash ?? undefined,
            approvedBy: 'cloud',
            approvedAt: new Date().toISOString(),
            cloudSkillId,
            aclApplied: false,
          });
        } else {
          this.storage.workspaceSkills.create({
            profileId: profile.id,
            workspacePath: ws,
            skillName,
            status: 'cloud_forced',
            contentHash: cloudHash ?? undefined,
            approvedBy: 'cloud',
            approvedAt: new Date().toISOString(),
            cloudSkillId,
            aclApplied: false,
          });
        }

        // Remove any deny ACL
        if (agentUsername) {
          allowWorkspaceSkill(wsSkillDir, agentUsername, this.logger);
        }

        targetWorkspaces.push(ws);
      }
    }

    eventBus.emit('workspace_skills:cloud_forced', { skillName, targetWorkspaces });

    this.logger.info(
      `[workspace-skills] cloud-forced skill pushed: ${skillName} to ${targetWorkspaces.length} workspace(s)`,
    );

    return targetWorkspaces;
  }

  /**
   * Deny and remove a workspace skill (used by cloud deny flow).
   * Applies deny ACL, deletes files from disk, marks removed in DB.
   */
  denyAndRemoveSkill(skillId: string): void {
    const skill = this.storage.workspaceSkills.getById(skillId);
    if (!skill || skill.status === 'removed') return;

    const agentUsername = this.resolveAgentUsername(skill.profileId);
    const skillPath = path.join(skill.workspacePath, '.claude', 'skills', skill.skillName);

    // Apply deny ACL
    if (agentUsername) {
      denyWorkspaceSkill(skillPath, agentUsername, this.logger);
    }

    // Delete skill files from disk
    try {
      if (fs.existsSync(skillPath)) {
        fs.rmSync(skillPath, { recursive: true, force: true });
      }
    } catch (err) {
      this.logger.warn(`[workspace-skills] failed to delete skill files: ${(err as Error).message}`);
    }

    // Mark removed in DB
    this.storage.workspaceSkills.markRemoved(skillId);

    // Clean up ACL
    if (agentUsername) {
      allowWorkspaceSkill(skillPath, agentUsername, this.logger);
    }

    eventBus.emit('workspace_skills:denied', {
      workspacePath: skill.workspacePath,
      skillName: skill.skillName,
    });

    this.logger.info(`[workspace-skills] denied and removed by cloud: ${skill.skillName} in ${skill.workspacePath}`);
  }

  /**
   * Revoke all skills for a single workspace path (mark removed + allow ACL).
   */
  private revokeWorkspaceSkills(workspacePath: string): void {
    const skills = this.storage.workspaceSkills.getByWorkspace(workspacePath);
    for (const skill of skills) {
      if (skill.status !== 'removed') {
        const agentUsername = this.resolveAgentUsername(skill.profileId);
        this.storage.workspaceSkills.markRemoved(skill.id);
        if (agentUsername) {
          const skillPath = path.join(workspacePath, '.claude', 'skills', skill.skillName);
          allowWorkspaceSkill(skillPath, agentUsername, this.logger);
        }
      }
    }
  }

  /**
   * Discover nested projects within a workspace root that have .claude/skills/.
   * Returns project root paths (excluding the root workspace itself).
   */
  private discoverNestedSkillsDirs(rootPath: string, maxDepth = 5): string[] {
    const results: string[] = [];

    const walk = (dir: string, depth: number): void => {
      if (depth > maxDepth) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.') || NESTED_SKIP_DIRS.has(entry.name)) continue;
        const child = path.join(dir, entry.name);
        // Check if this child has .claude/skills/
        const skillsDir = path.join(child, '.claude', 'skills');
        try {
          if (fs.statSync(skillsDir).isDirectory()) {
            results.push(child);
          }
        } catch {
          /* no .claude/skills/ here */
        }
        // Keep walking deeper regardless
        walk(child, depth + 1);
      }
    };

    walk(rootPath, 0);
    return results;
  }

  /**
   * Set up fs.watch on all workspace .claude/skills/ directories.
   */
  private setupWatchers(): void {
    for (const [, watcher] of this.watchers) watcher.close();
    this.watchers.clear();

    const profiles = this.storage.profiles.getAll();
    for (const profile of profiles) {
      const workspacePaths = (profile as { workspacePaths?: string[] }).workspacePaths ?? [];
      for (const ws of workspacePaths) {
        this.watchWorkspaceSkillsDir(profile.id, ws);

        // Also watch nested workspace skills dirs
        const nested = this.discoverNestedSkillsDirs(ws);
        for (const nestedPath of nested) {
          this.watchWorkspaceSkillsDir(profile.id, nestedPath);
        }
      }
    }
  }

  /**
   * Watch a single workspace's .claude/skills/ directory for changes.
   */
  private watchWorkspaceSkillsDir(profileId: string, workspacePath: string): void {
    const skillsDir = path.join(workspacePath, '.claude', 'skills');
    if (!fs.existsSync(skillsDir) || this.watchers.has(skillsDir)) return;

    try {
      const watcher = fs.watch(skillsDir, { persistent: false, recursive: true }, () => {
        if (this.stopped) return;
        this.debounceScan(profileId, workspacePath);
      });
      this.watchers.set(skillsDir, watcher);
      this.logger.debug(`[workspace-skills] watching ${skillsDir}`);
    } catch {
      // fs.watch may fail on some filesystems — polling fallback handles it
    }
  }

  /**
   * Debounced scan triggered by fs.watch events.
   */
  private debounceScan(profileId: string, workspacePath: string): void {
    const key = `${profileId}:${workspacePath}`;
    const existing = this.scanDebounceTimers.get(key);
    if (existing) clearTimeout(existing);

    this.scanDebounceTimers.set(key, setTimeout(() => {
      this.scanDebounceTimers.delete(key);
      try {
        this.scanWorkspace(profileId, workspacePath);
      } catch (err) {
        this.logger.error(`[workspace-skills] watch-triggered scan failed: ${(err as Error).message}`);
      }
    }, 500));
  }

  /**
   * Restore a cloud-forced skill from the cloud skills directory.
   */
  private restoreCloudForcedSkill(skillName: string, targetPath: string): void {
    const cloudDir = path.join(getCloudSkillsDir(), skillName);
    if (!fs.existsSync(cloudDir)) return;

    // Remove current contents and copy from cloud
    try {
      fs.rmSync(targetPath, { recursive: true, force: true });
      fs.mkdirSync(targetPath, { recursive: true });
      const files = readSkillFiles(cloudDir);
      for (const file of files) {
        const dest = path.join(targetPath, file.name);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, file.content, 'utf-8');
      }
    } catch (err) {
      this.logger.warn(`[workspace-skills] failed to restore cloud skill ${skillName}: ${(err as Error).message}`);
    }
  }
}
