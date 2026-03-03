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
import { denyWorkspaceSkill, allowWorkspaceSkill, syncWorkspaceSkillAcls } from '../acl';
import { getWorkspaceSkillBackupDir, getCloudSkillsDir } from '../config/paths';
import { eventBus } from '../events/emitter';

interface Logger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  debug(msg: string, ...args: unknown[]): void;
}

interface ScannerDeps {
  storage: Storage;
  logger: Logger;
  agentUsername: string;
  configDir: string;
}

/**
 * Read all files from a skill directory recursively (skips dot-files).
 */
function readSkillFiles(dir: string, prefix = ''): Array<{ name: string; content: string }> {
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

export class WorkspaceSkillScanner {
  private storage: Storage;
  private logger: Logger;
  private agentUsername: string;
  private pollTimer: NodeJS.Timeout | null = null;
  private watchers: Map<string, fs.FSWatcher> = new Map();
  private stopped = false;

  constructor(deps: ScannerDeps) {
    this.storage = deps.storage;
    this.logger = deps.logger;
    this.agentUsername = deps.agentUsername;
  }

  /**
   * Scan one workspace for skills. Called on grant and periodic re-scan.
   */
  scanWorkspace(profileId: string, workspacePath: string): WorkspaceSkill[] {
    const skillsDir = path.join(workspacePath, '.claude', 'skills');
    const results: WorkspaceSkill[] = [];

    if (!fs.existsSync(skillsDir)) {
      return results;
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    } catch {
      this.logger.warn(`[workspace-skills] cannot read ${skillsDir}`);
      return results;
    }

    const foundNames = new Set<string>();

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;

      const skillName = entry.name;
      foundNames.add(skillName);
      const skillPath = path.join(skillsDir, skillName);

      const existing = this.storage.workspaceSkills.getByKey(workspacePath, skillName);

      if (!existing) {
        // New skill — create as pending + apply deny ACL
        const contentHash = computeSkillHash(skillPath);
        const created = this.storage.workspaceSkills.create({
          profileId,
          workspacePath,
          skillName,
          status: 'pending',
          contentHash: contentHash ?? undefined,
          aclApplied: true,
        });

        if (this.agentUsername) {
          denyWorkspaceSkill(skillPath, this.agentUsername, this.logger);
        }

        eventBus.emit('workspace_skills:detected', {
          workspacePath,
          skillName,
          status: 'pending',
        });

        results.push(created);
        this.logger.info(`[workspace-skills] detected new skill: ${skillName} in ${workspacePath}`);
      } else if (existing.status === 'removed') {
        // Previously removed — don't re-add
        results.push(existing);
      } else if (existing.status === 'approved') {
        // Check for tampering
        const currentHash = computeSkillHash(skillPath);
        if (currentHash && existing.contentHash && currentHash !== existing.contentHash) {
          // Tampered — revert to pending
          this.storage.workspaceSkills.update(existing.id, {
            status: 'pending',
            contentHash: currentHash,
            aclApplied: true,
          });

          if (this.agentUsername) {
            denyWorkspaceSkill(skillPath, this.agentUsername, this.logger);
          }

          eventBus.emit('workspace_skills:tampered', {
            workspacePath,
            skillName,
            previousHash: existing.contentHash,
            currentHash,
          });

          this.logger.warn(`[workspace-skills] tamper detected: ${skillName} in ${workspacePath}`);
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
        // pending or denied — ensure deny ACL is applied
        if (!existing.aclApplied && this.agentUsername) {
          denyWorkspaceSkill(skillPath, this.agentUsername, this.logger);
          this.storage.workspaceSkills.update(existing.id, { aclApplied: true });
        }
        results.push(existing);
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
          continue;
        }
        this.scanWorkspace(profile.id, ws);
      }
    }
  }

  /**
   * Start periodic scanning.
   */
  start(pollIntervalMs = 30_000): void {
    this.stopped = false;

    // Initial scan
    try {
      this.scanAllWorkspaces();
    } catch (err) {
      this.logger.error(`[workspace-skills] initial scan failed: ${(err as Error).message}`);
    }

    // Periodic poll
    this.pollTimer = setInterval(() => {
      if (this.stopped) return;
      try {
        this.scanAllWorkspaces();
      } catch (err) {
        this.logger.error(`[workspace-skills] periodic scan failed: ${(err as Error).message}`);
      }
    }, pollIntervalMs);

    this.logger.info(`[workspace-skills] scanner started (poll every ${pollIntervalMs}ms)`);
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
    this.logger.info('[workspace-skills] scanner stopped');
  }

  /**
   * Called when a workspace path is granted to the agent.
   * Synchronously scans and applies ACLs before returning.
   */
  onWorkspaceGranted(profileId: string, workspacePath: string): void {
    this.scanWorkspace(profileId, workspacePath);
  }

  /**
   * Called when a workspace path is revoked.
   * Marks all skills for that workspace as removed.
   */
  onWorkspaceRevoked(workspacePath: string): void {
    const skills = this.storage.workspaceSkills.getByWorkspace(workspacePath);
    for (const skill of skills) {
      if (skill.status !== 'removed') {
        this.storage.workspaceSkills.markRemoved(skill.id);

        // Remove deny ACL
        if (this.agentUsername) {
          const skillPath = path.join(workspacePath, '.claude', 'skills', skill.skillName);
          allowWorkspaceSkill(skillPath, this.agentUsername, this.logger);
        }
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
    if (this.agentUsername) {
      allowWorkspaceSkill(skillPath, this.agentUsername, this.logger);
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

    const skillPath = path.join(skill.workspacePath, '.claude', 'skills', skill.skillName);

    const updated = this.storage.workspaceSkills.update(skillId, {
      status: 'denied' as WorkspaceSkillStatus,
      aclApplied: true,
    });

    if (this.agentUsername) {
      denyWorkspaceSkill(skillPath, this.agentUsername, this.logger);
    }

    eventBus.emit('workspace_skills:denied', {
      workspacePath: skill.workspacePath,
      skillName: skill.skillName,
    });

    this.logger.info(`[workspace-skills] denied: ${skill.skillName}`);
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
        if (this.agentUsername) {
          allowWorkspaceSkill(wsSkillDir, this.agentUsername, this.logger);
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
