/**
 * Skill watcher service — polling-based integrity monitor for deployed skills
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { EventEmitter } from 'node:events';
import type { SkillsRepository } from '@agenshield/storage';
import type { SkillEvent } from '../events';
import type { DeployService } from '../deploy';
import type { SkillBackupService } from '../backup';
import type { WatcherOptions, WatcherPolicy, ResolvedWatcherPolicy, WatcherAction, SkillScanCallbacks } from './types';

const DEFAULT_POLL_INTERVAL = 30_000;
const DEFAULT_POLICY: ResolvedWatcherPolicy = { onModified: 'reinstall', onDeleted: 'reinstall' };

interface SkillMeta {
  name: string;
  slug: string;
  version: string;
  description?: string;
}

interface CollectedFile {
  relativePath: string;
  content: Buffer;
}

export class SkillWatcherService {
  private readonly skills: SkillsRepository;
  private readonly deployer: DeployService;
  private readonly emitter: EventEmitter;
  private readonly pollIntervalMs: number;
  private readonly defaultPolicy: ResolvedWatcherPolicy;
  private readonly installationPolicies: Map<string, Partial<WatcherPolicy>>;
  private readonly skillsDir: string | null;
  private readonly quarantineDir: string | null;
  private readonly fsScanDebounceMs: number;
  private readonly backup: SkillBackupService | null;
  private scanCallbacks: SkillScanCallbacks = {};
  private timer: ReturnType<typeof setInterval> | null = null;
  private fsWatcher: fs.FSWatcher | null = null;
  private readonly debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private readonly suppressedSlugs: Set<string> = new Set();

  constructor(skills: SkillsRepository, deployer: DeployService, emitter: EventEmitter, options?: WatcherOptions, backup?: SkillBackupService | null) {
    this.skills = skills;
    this.deployer = deployer;
    this.emitter = emitter;
    this.pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL;
    this.skillsDir = options?.skillsDir ? path.resolve(options.skillsDir) : null;
    this.quarantineDir = options?.quarantineDir ?? null;
    this.defaultPolicy = {
      onModified: options?.defaultPolicy?.onModified ?? DEFAULT_POLICY.onModified,
      onDeleted: options?.defaultPolicy?.onDeleted ?? DEFAULT_POLICY.onDeleted,
    };
    this.fsScanDebounceMs = options?.fsScanDebounceMs ?? 500;
    this.backup = backup ?? null;
    this.installationPolicies = new Map(
      options?.installationPolicies ? Object.entries(options.installationPolicies) : [],
    );
  }

  /** Set callbacks for filesystem scan events */
  setScanCallbacks(cbs: SkillScanCallbacks): void {
    this.scanCallbacks = cbs;
  }

  private emit(event: SkillEvent): void {
    this.emitter.emit('skill-event', event);
  }

  /** Resolve the effective policy for an installation (per-installation overrides merged with defaults) */
  resolvePolicy(installationId: string): ResolvedWatcherPolicy {
    const override = this.installationPolicies.get(installationId);
    if (!override) return { ...this.defaultPolicy };
    return {
      onModified: override.onModified ?? this.defaultPolicy.onModified,
      onDeleted: override.onDeleted ?? this.defaultPolicy.onDeleted,
    };
  }

  /** Set a per-installation policy override */
  setInstallationPolicy(id: string, policy: Partial<WatcherPolicy>): void {
    this.installationPolicies.set(id, policy);
  }

  /** Remove a per-installation policy override */
  removeInstallationPolicy(id: string): void {
    this.installationPolicies.delete(id);
  }

  /** Start the polling loop and filesystem watcher */
  start(): void {
    if (this.timer) return;
    this.emit({ type: 'watcher:started', pollIntervalMs: this.pollIntervalMs });
    this.timer = setInterval(() => {
      this.poll().catch(() => {
        /* handled internally */
      });
    }, this.pollIntervalMs);
    this.startFsWatch();
  }

  /** Stop the polling loop and filesystem watcher */
  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    this.stopFsWatch();
    this.emit({ type: 'watcher:stopped' });
  }

  /** Whether the watcher is currently running */
  get isRunning(): boolean {
    return this.timer !== null;
  }

  // ---- fs.watch ----

  /** Start watching skillsDir recursively (instant detection of new skills + file changes) */
  private startFsWatch(): void {
    if (!this.skillsDir || this.fsWatcher) return;
    try {
      if (!fs.existsSync(this.skillsDir)) return;
      this.fsWatcher = fs.watch(this.skillsDir, { persistent: true, recursive: true }, (_eventType, filename) => {
        if (!filename) return;
        // Extract slug = first path segment
        const slug = filename.split(path.sep)[0];
        if (!slug) return;
        // Skip events caused by our own operations (quarantine removal, reinstall writes)
        if (this.suppressedSlugs.has(slug)) return;

        const existing = this.debounceTimers.get(slug);
        if (existing) clearTimeout(existing);
        this.debounceTimers.set(
          slug,
          setTimeout(() => {
            this.debounceTimers.delete(slug);
            // Re-check suppression — may have been added during debounce window
            if (this.suppressedSlugs.has(slug)) return;
            this.handleFsChange(slug);
          }, this.fsScanDebounceMs),
        );
      });
      this.fsWatcher.on('error', (err) => {
        this.emit({ type: 'watcher:error', error: `fs.watch error: ${err.message}` });
        this.fsWatcher?.close();
        this.fsWatcher = null;
        // Attempt restart after a delay
        setTimeout(() => this.startFsWatch(), 5000);
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.emit({ type: 'watcher:error', error: `Failed to start fs.watch: ${msg}` });
    }
  }

  /** Stop the filesystem watcher and clear pending debounce timers */
  private stopFsWatch(): void {
    if (this.fsWatcher) {
      this.fsWatcher.close();
      this.fsWatcher = null;
    }
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    this.suppressedSlugs.clear();
  }

  // ---- fs.watch routing ----

  /** Handle a debounced fs.watch event for a skill slug */
  private handleFsChange(slug: string): void {
    this.emit({ type: 'watcher:fs-change', slug });
    const skill = this.skills.getBySlug(slug);
    if (!skill) {
      // Unknown slug — scan for new skills
      this.scanForNewSkills();
      return;
    }
    if (this.hasActiveInstallation(skill.id)) {
      // Active installation — check integrity
      this.checkSlugIntegrity(skill).catch(() => {
        /* handled internally via events */
      });
      return;
    }
    // Known skill with no active installation — re-scan to quarantine
    this.scanForNewSkills();
  }

  /** Check integrity of all active installations for a skill and apply policy */
  private async checkSlugIntegrity(skill: { id: string }): Promise<void> {
    const operationId = crypto.randomUUID();
    const versions = this.skills.getVersions(skill.id);

    for (const version of versions) {
      const installations = this.skills.getInstallations({ skillVersionId: version.id });
      for (const inst of installations) {
        if (inst.status !== 'active') continue;

        const check = await this.deployer.checkIntegrity(inst.id);
        if (!check || check.result.intact) continue;

        await this.handleIntegrityViolation(operationId, inst.id, check.adapterId, check.result);
      }
    }
  }

  /** Apply watcher policy to a single integrity violation */
  private async handleIntegrityViolation(
    operationId: string,
    installationId: string,
    adapterId: string,
    result: { modifiedFiles: string[]; missingFiles: string[]; unexpectedFiles: string[] },
  ): Promise<void> {
    const policy = this.resolvePolicy(installationId);
    const hasModified = result.modifiedFiles.length > 0 || result.unexpectedFiles.length > 0;
    const hasDeleted = result.missingFiles.length > 0;

    let action: WatcherAction;
    if (hasModified && hasDeleted) {
      action = policy.onModified === 'quarantine' || policy.onDeleted === 'quarantine' ? 'quarantine' : 'reinstall';
    } else if (hasDeleted) {
      action = policy.onDeleted;
    } else {
      action = policy.onModified;
    }

    this.emit({
      type: 'watcher:integrity-violation',
      operationId,
      installationId,
      adapterId,
      modifiedFiles: result.modifiedFiles,
      missingFiles: result.missingFiles,
      unexpectedFiles: result.unexpectedFiles,
      action,
    });

    // Look up installation context — needed by both branches
    const inst = this.skills.getInstallationById(installationId);
    const version = inst ? this.skills.getVersionById(inst.skillVersionId) : null;
    const skill = version ? this.skills.getById(version.skillId) : null;
    const slug = skill?.slug;

    // Suppress BEFORE DB update — prevents racing fs.watch debounce from
    // seeing a quarantined installation and routing to scanForNewSkills
    if (slug) this.suppressSlug(slug);

    try {
      if (action === 'quarantine') {
        this.skills.updateInstallationStatus(installationId, { status: 'quarantined' });
        // Remove tampered files from disk
        if (version?.folderPath) {
          if (fs.existsSync(version.folderPath)) {
            if (this.quarantineDir) {
              const dest = path.join(this.quarantineDir, slug!);
              if (!fs.existsSync(this.quarantineDir)) {
                fs.mkdirSync(this.quarantineDir, { recursive: true });
              }
              this.moveToQuarantine(version.folderPath, dest);
            } else {
              this.removeDir(version.folderPath);
            }
          }
        }
        this.emit({ type: 'watcher:quarantined', operationId, installationId });
      } else {
        if (inst && version && skill) {
          await this.deployer.deploy(inst, version, skill);
          this.emit({ type: 'watcher:reinstalled', operationId, installationId });
        }
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.emit({ type: 'watcher:action-error', operationId, installationId, action, error: errorMsg });
    } finally {
      if (slug) this.unsuppressSlug(slug);
    }
  }

  /** Suppress fs.watch events for a slug (during external disk operations) */
  suppressSlug(slug: string): void {
    this.suppressedSlugs.add(slug);
    // Clear any pending debounce timer for this slug
    const pending = this.debounceTimers.get(slug);
    if (pending) {
      clearTimeout(pending);
      this.debounceTimers.delete(slug);
    }
  }

  /** Release slug suppression after a delay to let fs.watch events settle */
  unsuppressSlug(slug: string): void {
    setTimeout(() => this.suppressedSlugs.delete(slug), this.fsScanDebounceMs * 2);
  }

  // ---- Helpers ----

  /** Parse _meta.json if present, fall back to slug-derived defaults */
  private readSkillMeta(dir: string, slug: string): SkillMeta {
    const metaPath = path.join(dir, '_meta.json');
    try {
      if (fs.existsSync(metaPath)) {
        const raw = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        return {
          name: typeof raw.name === 'string' ? raw.name : (typeof raw.slug === 'string' ? raw.slug : slug),
          slug: typeof raw.slug === 'string' ? raw.slug : slug,
          version: typeof raw.version === 'string' ? raw.version : '0.0.0',
          description: typeof raw.description === 'string' ? raw.description : undefined,
        };
      }
    } catch {
      // fall through to defaults
    }
    return { name: slug, slug, version: '0.0.0' };
  }

  /** Recursively collect all files in a directory, skipping hidden dirs */
  private collectFiles(dir: string, base?: string): CollectedFile[] {
    const result: CollectedFile[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(dir, entry.name);
      const relativePath = base ? `${base}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        result.push(...this.collectFiles(fullPath, relativePath));
      } else if (entry.isFile()) {
        result.push({ relativePath, content: fs.readFileSync(fullPath) });
      }
    }
    return result;
  }

  /** Move a skill directory from src to dest (copy + remove) */
  private moveToQuarantine(srcDir: string, destDir: string): void {
    fs.cpSync(srcDir, destDir, { recursive: true });
    this.removeDir(srcDir);
  }

  /** Remove a directory, retrying once if it persists (macOS Finder handle race) */
  private removeDir(dir: string): void {
    fs.rmSync(dir, { recursive: true, force: true });
    if (fs.existsSync(dir)) {
      // Retry — OS may have released the handle after the first pass
      try { fs.rmdirSync(dir); } catch { /* best-effort */ }
    }
  }

  /** Check if a skill has any active installation across all its versions */
  private hasActiveInstallation(skillId: string): boolean {
    const versions = this.skills.getVersions(skillId);
    for (const version of versions) {
      const installations = this.skills.getInstallations({ skillVersionId: version.id });
      if (installations.some((inst) => inst.status === 'active')) return true;
    }
    return false;
  }

  /**
   * Scan the skills directory for unregistered skill directories.
   * A skill is considered unregistered if it lacks an active installation.
   * Unregistered skills are hashed, registered in DB as quarantined,
   * and moved to the quarantine directory.
   */
  scanForNewSkills(): void {
    if (!this.skillsDir) return;

    try {
      if (!fs.existsSync(this.skillsDir)) return;

      const operationId = crypto.randomUUID();
      const entries = fs.readdirSync(this.skillsDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const slug = entry.name;
        const skillDir = path.join(this.skillsDir, slug);

        // Check if this skill has an active installation
        const existingSkill = this.skills.getBySlug(slug);
        if (existingSkill && this.hasActiveInstallation(existingSkill.id)) {
          continue; // properly installed, skip
        }

        // Unregistered skill on disk — read metadata
        const meta = this.readSkillMeta(skillDir, slug);

        // Collect and hash all files
        const files = this.collectFiles(skillDir);
        const fileEntries = files.map((f) => ({
          relativePath: f.relativePath,
          fileHash: crypto.createHash('sha256').update(f.content).digest('hex'),
          sizeBytes: f.content.length,
        }));

        // Compute content hash from sorted file hashes
        const sortedHashes = fileEntries
          .sort((a, b) => a.relativePath.localeCompare(b.relativePath))
          .map((f) => f.fileHash)
          .join('');
        const contentHash = crypto.createHash('sha256').update(sortedHashes).digest('hex');

        // Create or reuse skill record
        let skill = existingSkill;
        if (!skill) {
          skill = this.skills.create({
            name: meta.name,
            slug: meta.slug,
            author: 'unknown',
            description: meta.description,
            source: 'watcher',
            tags: [],
          });
        }

        // Check for existing version with same (skillId, version)
        const existingVersion = this.skills.getVersion({ skillId: skill.id, version: meta.version });
        if (existingVersion) {
          if (existingVersion.contentHash === contentHash && existingVersion.approval === 'quarantined') {
            // Already registered with same content — just remove from skillsDir
            this.suppressSlug(slug);
            try {
              this.removeDir(skillDir);
            } finally {
              this.unsuppressSlug(slug);
            }
            continue;
          }
          // Content changed — remove old version so we can re-register
          this.skills.deleteVersion(existingVersion.id);
        }

        // Create quarantined version — folderPath points to original location (audit reference; files will be deleted)
        const version = this.skills.addVersion({
          skillId: skill.id,
          version: meta.version,
          folderPath: skillDir,
          contentHash,
          hashUpdatedAt: new Date().toISOString(),
          approval: 'quarantined',
          trusted: false,
          analysisStatus: 'pending',
          requiredBins: [],
          requiredEnv: [],
          extractedCommands: [],
        });

        // Register files in DB with hashes
        this.skills.registerFiles({
          versionId: version.id,
          files: fileEntries,
        });

        // Save backup copies of file content for reinstall recovery
        this.backup?.saveFiles(version.id, files);

        // Remove untrusted folder from skillsDir (no quarantine copy)
        this.suppressSlug(slug);
        try {
          this.removeDir(skillDir);
        } finally {
          this.unsuppressSlug(slug);
        }

        const reason = existingSkill
          ? 'Skill on disk has no active installation'
          : 'Skill not in approved list';

        this.scanCallbacks.onQuarantined?.(slug, reason);
        this.emit({
          type: 'watcher:skill-detected',
          operationId,
          slug,
          version: meta.version,
          quarantinePath: skillDir,
          reason,
        });
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.emit({ type: 'watcher:error', error: `Filesystem scan error: ${errorMsg}` });
    }
  }

  /** Execute a single integrity scan cycle */
  async poll(): Promise<void> {
    const operationId = crypto.randomUUID();
    this.emit({ type: 'watcher:poll-started', operationId });

    // Scan for new skills on disk before integrity checks
    this.scanForNewSkills();

    try {
      const checks = await this.deployer.checkAllIntegrity();
      let violationCount = 0;

      for (const check of checks) {
        if (check.result.intact) continue;
        violationCount++;
        await this.handleIntegrityViolation(operationId, check.installationId, check.adapterId, check.result);
      }

      this.emit({ type: 'watcher:poll-completed', operationId, checkedCount: checks.length, violationCount });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.emit({ type: 'watcher:error', error: errorMsg });
    }
  }
}
