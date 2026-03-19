/**
 * Cloud connector service
 *
 * Manages the connection from the local AgenShield daemon to AgenShield Cloud.
 * Transport (WebSocket/HTTP, auth headers, heartbeat, reconnect) is handled by
 * CloudClient from @agenshield/cloud. This service owns the business logic:
 * what to DO when commands arrive.
 */

import { CloudClient } from '@agenshield/cloud';
import type { CloudCommand, CloudCredentials } from '@agenshield/cloud';
import type { PolicyConfig } from '@agenshield/ipc';
import { PolicyConfigSchema } from '@agenshield/ipc';
import { getStorage } from '@agenshield/storage';
import { getLogger } from '../logger';
import { clearConfigCache } from '../config/index';
import { emitPoliciesUpdated, emitProcessViolation, emitProcessKilled } from '../events/emitter';
import { getPolicyManager } from './policy-manager';
import { triggerProcessEnforcement, scanHostProcesses, killProcessTree, resolveExePathsByPid } from './process-enforcer';
import { matchProcessPattern } from '@agenshield/policies';
import { fingerprintProcess } from './process-fingerprint';
import type { ProcessFingerprint } from './process-fingerprint';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maps cloud target process identifiers to glob patterns for matching */
const TARGET_PROCESS_PATTERNS: Record<string, string[]> = {
  'claude-code': ['*claude*', 'claude:*'],
  'openclaw': ['*openclaw*', 'openclaw:*'],
};

// ---------------------------------------------------------------------------
// Cloud Connector
// ---------------------------------------------------------------------------

export class CloudConnector {
  private client: CloudClient;
  private _autoShieldFromCloud: boolean | undefined;

  constructor() {
    this.client = new CloudClient({ logger: getLogger() });

    this.client.setCommandHandler((command) => this.handleCommand(command));
    this.client.setOnConnect(() => this.onConnected());
  }

  /**
   * Try to connect to AgenShield Cloud.
   * Loads credentials from SQLite first, falling back to file.
   * No-ops if credentials don't exist.
   */
  async connect(): Promise<void> {
    try {
      const storage = getStorage();
      const identity = storage.cloudIdentity.get();
      if (identity?.agentId && identity.privateKey && identity.cloudUrl) {
        this.client.setCredentials({
          agentId: identity.agentId,
          privateKey: identity.privateKey,
          cloudUrl: identity.cloudUrl,
          companyName: identity.companyName ?? '',
          registeredAt: identity.enrolledAt ?? new Date().toISOString(),
        });
      }
    } catch {
      // Storage may not be ready — client will try file fallback
    }
    await this.client.connect();
  }

  /**
   * Disconnect from AgenShield Cloud.
   */
  disconnect(): void {
    this.client.disconnect();
  }

  /**
   * Whether the daemon is currently connected to cloud.
   */
  isConnected(): boolean {
    return this.client.isConnected();
  }

  /**
   * Get the enrolled company name (or undefined if not enrolled).
   */
  getCompanyName(): string | undefined {
    return this.client.getCredentials()?.companyName;
  }

  /**
   * Get the cloud-driven auto-shield flag (undefined if not received from cloud).
   */
  getAutoShieldFlag(): boolean | undefined {
    return this._autoShieldFromCloud;
  }

  // ─── Post-connection actions ──────────────────────────────

  private async onConnected(): Promise<void> {
    const log = getLogger();

    this.pullPoliciesWithRetry().catch((err) => {
      log.warn({ err }, '[cloud] Initial policy pull failed after all retries');
    });
    this.pullMcpServers().catch((err) => {
      log.warn({ err }, '[cloud] Initial MCP servers pull failed');
    });

    // Sync claim state from cloud (so already-claimed devices show user info after restart)
    this.syncClaimState().catch((err) => {
      log.debug({ err }, '[cloud] Claim state sync failed');
    });

    // Re-scan skills after bundle sync applies cloud-approved hashes
    import('../watchers/skills').then(({ triggerSkillsScan }) => {
      triggerSkillsScan();
    }).catch((err) => {
      log.debug({ err }, '[cloud] Skills re-scan after connect failed');
    });
  }

  private async syncClaimState(): Promise<void> {
    const { getClaimService } = await import('./claim');
    const creds = this.client.getCredentials();
    if (creds?.agentId && creds.privateKey && creds.cloudUrl) {
      await getClaimService().syncFromCloud(creds.cloudUrl, creds.agentId, creds.privateKey);
    }
  }

  // ─── Command dispatch ─────────────────────────────────────

  private async handleCommand(command: CloudCommand): Promise<void> {
    const log = getLogger();

    switch (command.method) {
      case 'push_policy':
        log.info(`[cloud] Received policy push: ${JSON.stringify(command.params).slice(0, 200)}`);
        await this.applyPolicyPush(command.params);
        break;

      case 'update_config':
        log.info('[cloud] Received config update');
        // TODO: Apply config update
        break;

      case 'push_binary_signatures':
        log.info(`[cloud] Received binary signatures push: ${JSON.stringify(command.params).slice(0, 200)}`);
        await this.applySignaturePush(command.params);
        break;

      case 'kill_process':
        log.info(`[cloud] Received kill_process command: ${JSON.stringify(command.params).slice(0, 200)}`);
        await this.handleKillProcess(command.params);
        break;

      case 'push_forced_skills':
        log.info(`[cloud] Received forced skills push: ${JSON.stringify(command.params).slice(0, 200)}`);
        await this.handlePushForcedSkills(command.params);
        break;

      case 'push_mcp_servers':
        log.info(`[cloud] Received MCP servers push: ${JSON.stringify(command.params).slice(0, 200)}`);
        await this.handlePushMcpServers(command.params);
        break;

      case 'push_bundle':
        log.info(`[cloud] Received bundle push: revision=${(command.params as Record<string, unknown>)?.revision ?? 'unknown'}`);
        await this.handlePushBundle(command.params);
        break;

      case 'update_approved_hashes':
        log.info('[cloud] Received approved skill hashes update');
        await this.handleUpdateApprovedHashes(command.params);
        break;

      case 'ping':
        // Handled by CloudClient
        break;

      default:
        log.debug(`[cloud] Unknown command: ${command.method}`);
    }
  }

  // ─── Policy push ─────────────────────────────────────────────

  /**
   * Apply a push_policy command: replace managed policies from a source, then recompile + enforce.
   */
  private async applyPolicyPush(params: Record<string, unknown>): Promise<void> {
    const log = getLogger();
    const source = (params.source as string) ?? 'cloud';
    const rawPolicies = params.policies;

    if (!Array.isArray(rawPolicies)) {
      log.warn('[cloud] push_policy: missing or invalid policies array');
      return;
    }

    try {
      const storage = getStorage();
      const policyRepo = storage.policies;

      // Delete existing managed policies from this source
      policyRepo.deleteManagedBySource(source);

      // Insert new managed policies
      let count = 0;
      for (const raw of rawPolicies) {
        try {
          const parsed = PolicyConfigSchema.parse(raw);
          policyRepo.createManaged(parsed, source);
          count++;
        } catch (err) {
          log.warn({ err, policy: raw }, '[cloud] Skipping invalid policy in push');
        }
      }

      // Clear stale config cache so loadConfig() re-reads managed policies from DB
      clearConfigCache();

      // Recompile the policy engine
      const policyManager = getPolicyManager();
      policyManager.recompile();

      log.info(`[cloud] Applied ${count} managed policies from source "${source}"`);

      // Emit activity event for policy push
      emitPoliciesUpdated({ source, count });

      // Trigger immediate process enforcement scan
      await triggerProcessEnforcement();
    } catch (err) {
      log.error({ err }, '[cloud] Failed to apply policy push');
    }
  }

  // ─── Binary signature push ─────────────────────────────────────

  /**
   * Apply a push_binary_signatures command: replace cloud signatures, then trigger enforcement.
   */
  private async applySignaturePush(params: Record<string, unknown>): Promise<void> {
    const log = getLogger();
    const rawSignatures = params.signatures;

    if (!Array.isArray(rawSignatures)) {
      log.warn('[cloud] push_binary_signatures: missing or invalid signatures array');
      return;
    }

    try {
      const storage = getStorage();
      const repo = storage.binarySignatures;

      // Full replace: delete existing cloud signatures, then upsert new ones
      repo.deleteBySource('cloud');
      const count = repo.upsertBatch(rawSignatures);

      log.info(`[cloud] Synced ${count} binary signatures from cloud`);

      // Trigger immediate process enforcement scan with updated signatures
      await triggerProcessEnforcement();
    } catch (err) {
      log.error({ err }, '[cloud] Failed to apply binary signature push');
    }
  }

  // ─── Kill process ──────────────────────────────────────────────

  /**
   * Handle a kill_process command from cloud.
   * Scans running host processes and kills/alerts on matches.
   */
  private async handleKillProcess(params: Record<string, unknown>): Promise<void> {
    const log = getLogger();
    const targetProcess = params.targetProcess as string | undefined;
    const action = (params.action as string) ?? 'alert';

    if (!targetProcess) {
      log.warn('[cloud] kill_process: missing targetProcess');
      return;
    }

    const patterns = TARGET_PROCESS_PATTERNS[targetProcess];
    if (!patterns) {
      log.warn(`[cloud] kill_process: unknown targetProcess "${targetProcess}"`);
      return;
    }

    let processes;
    try {
      processes = await scanHostProcesses();
    } catch (err) {
      log.error({ err }, '[cloud] kill_process: failed to scan processes');
      return;
    }

    // Fingerprint helpers for signature-based identification
    const fpCache = new Map<string, ProcessFingerprint>();
    const hashLookup = (sha256: string): string | null => {
      try {
        const sig = getStorage().binarySignatures.lookupBySha256(sha256, process.platform);
        return sig?.packageName ?? null;
      } catch { return null; }
    };

    // Batch-resolve executable paths from OS (macOS proc_pidpath)
    const exePathsByPid = await resolveExePathsByPid(processes.map(p => p.pid));

    for (const proc of processes) {
      // Layer 1: Name-based pattern matching
      let matched = patterns.some(pattern => matchProcessPattern(pattern, proc.command));

      // Layer 2: Fingerprint-based identification (catches renamed binaries via SHA256)
      if (!matched) {
        const fp = fingerprintProcess(proc.command, { cache: fpCache, hashLookup, resolvedExePath: exePathsByPid.get(proc.pid) });
        if (fp.candidateNames.length > 0) {
          matched = fp.candidateNames.some(candidate =>
            patterns.some(pattern => matchProcessPattern(pattern, candidate)),
          );
          if (matched) {
            log.info(
              `[cloud] kill_process: PID ${proc.pid} identified as "${fp.candidateNames[0]}" ` +
              `via ${fp.resolvedVia} (command: ${proc.command.slice(0, 80)})`,
            );
          }
        }
      }

      if (!matched) continue;

      const payload = {
        pid: proc.pid,
        user: proc.user,
        command: proc.command,
        policyId: `cloud:kill_process:${targetProcess}`,
        enforcement: action as 'alert' | 'kill',
        reason: `Cloud kill_process command for ${targetProcess}`,
      };

      if (action === 'kill') {
        log.warn(`[cloud] Killing process PID ${proc.pid}: ${proc.command.slice(0, 120)}`);
        emitProcessViolation(payload);
        await killProcessTree(proc.pid);
        emitProcessKilled(payload);
      } else {
        log.info(`[cloud] Process violation (${action}): PID ${proc.pid}: ${proc.command.slice(0, 120)}`);
        emitProcessViolation(payload);
      }
    }
  }

  /**
   * Pull policies from cloud after connecting.
   */
  async pullPolicies(): Promise<void> {
    const log = getLogger();
    try {
      const body = await this.client.agentGet<{ source?: string; policies?: PolicyConfig[]; autoShield?: boolean }>('/policies');
      if (body.policies && Array.isArray(body.policies)) {
        await this.applyPolicyPush({
          source: body.source ?? 'cloud',
          policies: body.policies,
        });
        log.info(`[cloud] Pulled ${body.policies.length} policies from cloud`);
      }
      if (body.autoShield !== undefined) {
        this._autoShieldFromCloud = body.autoShield;
      }
    } catch (err) {
      log.warn({ err }, '[cloud] Failed to pull policies');
      throw err;
    }
  }

  /**
   * Pull policies with retry logic for post-enrollment reliability.
   * Retries with exponential backoff to handle cloud propagation delays.
   */
  async pullPoliciesWithRetry(maxRetries = 3): Promise<void> {
    const log = getLogger();
    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.pullPolicies();
        return;
      } catch (err) {
        lastError = err as Error;
        log.warn(`[cloud] Policy pull attempt ${attempt}/${maxRetries} failed: ${lastError.message}`);
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, attempt * 2000));
        }
      }
    }
    throw lastError ?? new Error('pullPoliciesWithRetry exhausted all retries');
  }

  /**
   * Verify workspace skills against the cloud.
   * Sends skill hashes for approval check; returns per-skill approval status.
   */
  async verifyWorkspaceSkills(
    skills: Array<{ skillName: string; contentHash: string; fileList: string[] }>,
  ): Promise<Array<{ skillName: string; approved: boolean; cloudSkillId?: string }>> {
    const log = getLogger();
    try {
      const body = await this.client.agentPost<{ results?: Array<{ skillName: string; approved: boolean; cloudSkillId?: string }> }>(
        '/workspace-skills/verify',
        { skills },
      );
      return body.results ?? [];
    } catch (err) {
      log.debug({ err }, '[cloud] Failed to verify workspace skills');
      return [];
    }
  }

  /**
   * Handle cloud-pushed forced skills.
   * Stores skill files locally and pushes them to all active workspaces.
   */
  private async handlePushForcedSkills(params: Record<string, unknown>): Promise<void> {
    const log = getLogger();
    const skills = params.skills as Array<{ name: string; files: Array<{ name: string; content: string }>; cloudSkillId?: string }> | undefined;

    if (!Array.isArray(skills)) {
      log.warn('[cloud] push_forced_skills: missing or invalid skills array');
      return;
    }

    // Lazily import scanner to avoid circular dependency
    const { WorkspaceSkillScanner } = await import('./workspace-skill-scanner');

    const storage = getStorage();

    const scanner = new WorkspaceSkillScanner({
      storage,
      logger: log,
      configDir: '',
    });

    for (const skill of skills) {
      try {
        scanner.pushCloudForcedSkill(skill.name, skill.files, skill.cloudSkillId);
        log.info(`[cloud] Pushed forced skill: ${skill.name}`);
      } catch (err) {
        log.warn(`[cloud] Failed to push forced skill ${skill.name}: ${(err as Error).message}`);
      }
    }
  }

  /**
   * Handle cloud-pushed MCP servers.
   * Replaces all managed MCP servers from the given source with the new set.
   */
  private async handlePushMcpServers(params: Record<string, unknown>): Promise<void> {
    const log = getLogger();
    const servers = params.servers as Array<Record<string, unknown>> | undefined;
    const source = (params.source as string) ?? 'cloud';

    if (!Array.isArray(servers)) {
      log.warn('[cloud] push_mcp_servers: missing or invalid servers array');
      return;
    }

    try {
      const { getMcpManager } = await import('./mcp-manager');
      const manager = getMcpManager();
      const result = manager.applyManagedPush(
        servers.map((s) => ({
          name: (s.name as string) ?? '',
          slug: (s.slug as string) ?? '',
          transport: ((s.transport as string) ?? 'stdio') as 'stdio' | 'sse' | 'streamable-http',
          description: (s.description as string) ?? '',
          url: (s.url as string) ?? null,
          command: (s.command as string) ?? null,
          args: (s.args as string[]) ?? [],
          env: (s.env as Record<string, string>) ?? {},
          headers: (s.headers as Record<string, string>) ?? {},
          authType: ((s.authType as string) ?? 'none') as 'none' | 'oauth' | 'apikey' | 'bearer',
          authConfig: (s.authConfig as Record<string, unknown>) ?? null,
          source: 'cloud' as const,
          supportedTargets: (s.supportedTargets as string[]) ?? [],
        })),
        source,
      );
      log.info(`[cloud] MCP servers push: added=${result.added}, removed=${result.removed}`);
    } catch (err) {
      log.warn(`[cloud] Failed to apply MCP servers push: ${(err as Error).message}`);
    }
  }

  /**
   * Pull MCP servers from the cloud policy server.
   */
  async pullMcpServers(): Promise<void> {
    const log = getLogger();
    try {
      const body = await this.client.agentGet<{ source?: string; servers?: Array<Record<string, unknown>> }>('/mcp-servers');
      if (body.servers && Array.isArray(body.servers)) {
        await this.handlePushMcpServers({
          source: body.source ?? 'cloud',
          servers: body.servers,
        });
        log.info(`[cloud] Pulled ${body.servers.length} MCP servers from cloud`);
      }
    } catch (err) {
      log.warn({ err }, '[cloud] Failed to pull MCP servers');
    }
  }

  /**
   * Report a quarantined skill to the cloud for CISO review.
   * Optionally includes full file contents so the admin can analyze remotely.
   */
  async reportQuarantinedSkill(
    sha256: string,
    name: string,
    source?: string,
  ): Promise<{ id?: string; existingDecision?: string }> {
    const log = getLogger();
    try {
      const body = await this.client.post<{ id: string; existingDecision?: string }>(
        '/skills/report',
        { sha256, name, source },
      );
      log.info(`[cloud] Reported quarantined skill: ${name} (sha256=${sha256.slice(0, 12)}...)`);
      return body;
    } catch (err) {
      log.warn({ err }, '[cloud] Failed to report quarantined skill');
      return {};
    }
  }

  /**
   * Handle an update_approved_hashes command: replace approved hashes and re-scan skills.
   */
  private async handleUpdateApprovedHashes(params: Record<string, unknown>): Promise<void> {
    const log = getLogger();
    const hashes = params.hashes as Array<{ sha256: string; name?: string }> | undefined;

    if (!Array.isArray(hashes)) {
      log.warn('[cloud] update_approved_hashes: missing or invalid hashes array');
      return;
    }

    try {
      const storage = getStorage();
      storage.approvedSkillHashes.replaceAll(
        hashes.map((h) => ({ sha256: h.sha256, displayName: h.name })),
      );
      log.info(`[cloud] Updated ${hashes.length} approved skill hashes`);

      // Re-scan skills to auto-approve newly approved hashes
      const { triggerSkillsScan } = await import('../watchers/skills');
      triggerSkillsScan();
    } catch (err) {
      log.error({ err }, '[cloud] Failed to update approved skill hashes');
    }
  }

  /**
   * Handle a push_bundle command: update policies + approved skill hashes.
   */
  private async handlePushBundle(params: Record<string, unknown>): Promise<void> {
    const log = getLogger();
    const storage = getStorage();

    // Apply policies from bundle
    const policies = params['policies'] as unknown[];
    if (Array.isArray(policies)) {
      await this.applyPolicyPush({ source: 'cloud', policies });
    }

    // Sync approved skill hashes
    const approvedSkillHashes = params['approvedSkillHashes'] as Array<{ sha256: string; name?: string }>;
    if (Array.isArray(approvedSkillHashes)) {
      storage.approvedSkillHashes.replaceAll(
        approvedSkillHashes.map(h => ({
          sha256: h.sha256,
          displayName: h.name,
        })),
      );
      log.info(`[cloud] Synced ${approvedSkillHashes.length} approved skill hashes`);
    }

    // Update bundle revision in cloud identity
    const revision = params['revision'] as string | undefined;
    if (revision) {
      storage.cloudIdentity.updateBundleRevision(revision);
    }
  }
}

// Singleton
let cloudConnector: CloudConnector | null = null;

export function getCloudConnector(): CloudConnector {
  if (!cloudConnector) {
    cloudConnector = new CloudConnector();
  }
  return cloudConnector;
}
