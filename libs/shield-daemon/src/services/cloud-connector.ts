/**
 * Cloud connector service
 *
 * Manages the connection from the local AgenShield daemon to AgenShield Cloud.
 * Uses WebSocket with Ed25519 AgentSig authentication, falling back to HTTP polling.
 *
 * Auth primitives (AgentSig header, credential loading) come from @agenshield/auth.
 */

import {
  createAgentSigHeader,
  loadCloudCredentials,
} from '@agenshield/auth';
import type { CloudCredentials } from '@agenshield/auth';
import type { PolicyConfig } from '@agenshield/ipc';
import { PolicyConfigSchema } from '@agenshield/ipc';
import { getStorage } from '@agenshield/storage';
import { getLogger } from '../logger';
import { clearConfigCache } from '../config/index';
import { emitPoliciesUpdated, emitProcessViolation, emitProcessKilled } from '../events/emitter';
import { getPolicyManager } from './policy-manager';
import { triggerProcessEnforcement, scanHostProcesses, killProcessTree } from './process-enforcer';
import { matchProcessPattern } from '@agenshield/policies';
import { fingerprintProcess } from './process-fingerprint';
import type { ProcessFingerprint } from './process-fingerprint';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CloudCommand {
  id: string;
  method: string;
  params: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Cloud Connector
// ---------------------------------------------------------------------------

const HEARTBEAT_INTERVAL = 30_000;
const RECONNECT_DELAY = 10_000;
const POLL_INTERVAL = 30_000;

/** Maps cloud target process identifiers to glob patterns for matching */
const TARGET_PROCESS_PATTERNS: Record<string, string[]> = {
  'claude-code': ['*claude*', 'claude:*'],
  'openclaw': ['*openclaw*', 'openclaw:*'],
};

export class CloudConnector {
  private credentials: CloudCredentials | null = null;
  private ws: import('ws').WebSocket | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private connected = false;
  private stopped = false;
  private lastCommandFetch: string | undefined;

  /**
   * Try to connect to AgenShield Cloud.
   * No-ops if credentials don't exist.
   */
  async connect(): Promise<void> {
    this.stopped = false;
    this.credentials = loadCloudCredentials();

    if (!this.credentials) {
      return;
    }

    const log = getLogger();
    log.info(`[cloud] Connecting to ${this.credentials.cloudUrl} as agent ${this.credentials.agentId}`);

    try {
      await this.connectWebSocket();
    } catch {
      log.warn('[cloud] WebSocket connection failed, falling back to HTTP polling');
      this.startPolling();
    }
  }

  /**
   * Disconnect from AgenShield Cloud.
   */
  disconnect(): void {
    this.stopped = true;

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close(1000, 'Daemon shutting down');
      } catch { /* ignore */ }
      this.ws = null;
    }

    this.connected = false;
  }

  /**
   * Whether the daemon is currently connected to cloud.
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get the enrolled company name (or undefined if not enrolled).
   */
  getCompanyName(): string | undefined {
    return this.credentials?.companyName;
  }

  // ─── WebSocket connection ──────────────────────────────────

  private async connectWebSocket(): Promise<void> {
    if (!this.credentials || this.stopped) return;

    const { WebSocket } = await import('ws');

    const wsUrl = this.credentials.cloudUrl
      .replace(/^https:/, 'wss:')
      .replace(/^http:/, 'ws:');

    const authHeader = this.makeAuthHeader();

    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`${wsUrl}/ws/agents`, {
        headers: { Authorization: authHeader },
      });

      const connectionTimeout = setTimeout(() => {
        ws.close();
        reject(new Error('WebSocket connection timed out'));
      }, 10_000);

      ws.on('open', () => {
        clearTimeout(connectionTimeout);
        this.ws = ws;
        this.connected = true;
        this.startHeartbeat();

        const log = getLogger();
        log.info('[cloud] WebSocket connected');
        resolve();

        // Pull policies after connecting
        this.pullPoliciesWithRetry().catch((err) => {
          const rlog = getLogger();
          rlog.warn({ err }, '[cloud] Initial policy pull failed after all retries');
        });
      });

      ws.on('message', (data) => {
        this.handleMessage(data.toString());
      });

      ws.on('close', () => {
        clearTimeout(connectionTimeout);
        this.connected = false;
        this.ws = null;
        this.stopHeartbeat();

        if (!this.stopped) {
          const log = getLogger();
          log.warn('[cloud] WebSocket disconnected, reconnecting...');
          this.scheduleReconnect();
        }
      });

      ws.on('error', (err) => {
        clearTimeout(connectionTimeout);
        const log = getLogger();
        log.warn(`[cloud] WebSocket error: ${err.message}`);
        reject(err);
      });
    });
  }

  private handleMessage(raw: string): void {
    try {
      const msg = JSON.parse(raw) as { jsonrpc: string; id?: string; method: string; params?: Record<string, unknown> };

      const log = getLogger();
      log.debug(`[cloud] Received command: ${msg.method}`);

      this.handleCommand({
        id: msg.id ?? '',
        method: msg.method,
        params: msg.params ?? {},
      }).catch(err => {
        const errLog = getLogger();
        errLog.error({ err }, '[cloud] Error handling command');
      });
    } catch {
      const log = getLogger();
      log.warn('[cloud] Invalid message received');
    }
  }

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

      case 'ping':
        // Respond to server ping
        if (this.ws?.readyState === 1) { // WebSocket.OPEN
          this.ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'pong', params: {} }));
        }
        break;

      default:
        log.debug(`[cloud] Unknown command: ${command.method}`);
    }

    // Send acknowledgement
    if (command.id && this.ws?.readyState === 1) {
      this.ws.send(JSON.stringify({
        jsonrpc: '2.0',
        method: 'command_ack',
        params: { commandId: command.id },
      }));
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === 1) {
        this.ws.ping();
      }
    }, HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.stopped) return;

      try {
        await this.connectWebSocket();
      } catch {
        // Fall back to polling if WS keeps failing
        this.startPolling();
      }
    }, RECONNECT_DELAY);
  }

  // ─── HTTP polling fallback ─────────────────────────────────

  private startPolling(): void {
    if (this.stopped || this.pollTimer) return;

    const log = getLogger();
    log.info('[cloud] Starting HTTP polling fallback');

    this.connected = true; // Consider polling as "connected"

    this.pollTimer = setInterval(async () => {
      if (this.stopped) return;
      await this.pollCommands();
    }, POLL_INTERVAL);

    // Initial poll + pull policies
    this.pollCommands();
    this.pullPoliciesWithRetry().catch((err) => {
      const rlog = getLogger();
      rlog.warn({ err }, '[cloud] Initial policy pull failed after all retries (polling)');
    });
  }

  private async pollCommands(): Promise<void> {
    if (!this.credentials) return;

    try {
      const url = new URL(
        `/api/agents/${this.credentials.agentId}/commands`,
        this.credentials.cloudUrl,
      );
      if (this.lastCommandFetch) {
        url.searchParams.set('since', this.lastCommandFetch);
      }

      const authHeader = this.makeAuthHeader();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      const res = await fetch(url.toString(), {
        headers: { Authorization: authHeader },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) return;

      const commands = (await res.json()) as CloudCommand[];
      this.lastCommandFetch = new Date().toISOString();

      for (const cmd of commands) {
        await this.handleCommand(cmd);

        // Acknowledge via HTTP
        try {
          await fetch(
            `${this.credentials.cloudUrl}/api/agents/${this.credentials.agentId}/ack`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: authHeader,
              },
              body: JSON.stringify({ commandId: cmd.id }),
            },
          );
        } catch { /* best effort */ }
      }
    } catch {
      // Polling failed — will retry next interval
    }
  }

  // ─── Authentication ────────────────────────────────────────

  /**
   * Create a fresh AgentSig authorization header using @agenshield/auth.
   */
  private makeAuthHeader(): string {
    if (!this.credentials) return '';
    return createAgentSigHeader(this.credentials.agentId, this.credentials.privateKey);
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

    for (const proc of processes) {
      // Layer 1: Name-based pattern matching
      let matched = patterns.some(pattern => matchProcessPattern(pattern, proc.command));

      // Layer 2: Fingerprint-based identification (catches renamed binaries via SHA256)
      if (!matched) {
        const fp = fingerprintProcess(proc.command, { cache: fpCache, hashLookup });
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
   * Called after WebSocket connect and after first HTTP poll.
   */
  async pullPolicies(): Promise<void> {
    if (!this.credentials) return;

    const log = getLogger();
    try {
      const url = new URL(
        `/api/agents/${this.credentials.agentId}/policies`,
        this.credentials.cloudUrl,
      );

      const authHeader = this.makeAuthHeader();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      const res = await fetch(url.toString(), {
        headers: { Authorization: authHeader },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} pulling policies`);
      }

      const body = await res.json() as { source?: string; policies?: PolicyConfig[] };
      if (body.policies && Array.isArray(body.policies)) {
        await this.applyPolicyPush({
          source: body.source ?? 'cloud',
          policies: body.policies,
        });
        log.info(`[cloud] Pulled ${body.policies.length} policies from cloud`);
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
    if (!this.credentials) return [];

    try {
      const agentId = this.credentials.agentId;
      const authHeader = this.makeAuthHeader();
      const url = `${this.credentials.cloudUrl}/api/agents/${agentId}/workspace-skills/verify`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader,
        },
        body: JSON.stringify({ skills }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        log.warn(`[cloud] Failed to verify workspace skills: ${res.status}`);
        return [];
      }

      const body = await res.json() as { results?: Array<{ skillName: string; approved: boolean; cloudSkillId?: string }> };
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
    const profiles = storage.profiles.getByType('target');
    const agentUsername = profiles[0]?.agentUsername ?? '';

    const scanner = new WorkspaceSkillScanner({
      storage,
      logger: log,
      agentUsername,
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
}

// Singleton
let cloudConnector: CloudConnector | null = null;

export function getCloudConnector(): CloudConnector {
  if (!cloudConnector) {
    cloudConnector = new CloudConnector();
  }
  return cloudConnector;
}
