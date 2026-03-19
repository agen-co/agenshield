/**
 * Claim Service — owns claim-session lifecycle (create / poll / persist)
 *
 * A "claim" links a user to a managed device. The device is already cloud-enrolled
 * (has an agentId + Ed25519 keypair), but no individual user has logged in yet.
 *
 * The service is used by both the Claude launch-gate and the general
 * POST /api/cloud/claim route.
 */

import { getStorage } from '@agenshield/storage';
import { createAgentSigHeader } from '@agenshield/cloud';
import { getLogger } from '../logger';

const log = getLogger().child({ context: 'ClaimService' });

export interface ClaimUser {
  id: string;
  name: string;
  email: string;
}

export interface ClaimResult {
  status: 'unclaimed' | 'pending' | 'claimed' | 'not_enrolled' | 'failed';
  claimUrl?: string;
  claimSessionId?: string;
  user?: ClaimUser;
  message?: string;
}

let instance: ClaimService | null = null;

export function getClaimService(): ClaimService {
  if (!instance) instance = new ClaimService();
  return instance;
}

class ClaimService {
  /**
   * Get current claim status from local storage.
   */
  getClaim(): ClaimResult {
    const storage = getStorage();
    const identity = storage.cloudIdentity.get();

    if (!identity?.agentId) {
      return { status: 'not_enrolled', message: 'Device not registered.' };
    }

    if (identity.claimStatus === 'claimed') {
      const user = identity.claimedUserId
        ? {
            id: identity.claimedUserId,
            name: identity.claimedUserName ?? '',
            email: identity.claimedUserEmail ?? '',
          }
        : undefined;
      return { status: 'claimed', user };
    }

    if (identity.claimStatus === 'pending') {
      const sessionId = storage.getMeta('claim.sessionId');
      const claimUrl = storage.getMeta('claim.url');
      return {
        status: 'pending',
        claimSessionId: sessionId ?? undefined,
        claimUrl: claimUrl ?? undefined,
        message: 'Waiting for login approval.',
      };
    }

    return { status: 'unclaimed', message: 'Login required.' };
  }

  /**
   * Start or poll a claim session. Idempotent — if a session is already
   * pending it polls it; if none exists it creates one.
   */
  async startOrPollClaim(): Promise<ClaimResult> {
    const storage = getStorage();
    const identity = storage.cloudIdentity.get();

    if (!identity?.agentId || !identity.privateKey || !identity.cloudUrl) {
      return { status: 'not_enrolled', message: 'Device not registered.' };
    }

    if (identity.claimStatus === 'claimed') {
      return this.getClaim();
    }

    const authHeader = createAgentSigHeader(identity.agentId, identity.privateKey);

    // Check for existing pending session
    const existingSessionId = storage.getMeta('claim.sessionId');
    if (existingSessionId) {
      const pollResult = await this.pollSession(identity.cloudUrl, identity.agentId, existingSessionId, authHeader);
      if (pollResult) return pollResult;
      // Stale session — clear and create a new one
      storage.deleteMeta('claim.sessionId');
      storage.deleteMeta('claim.url');
    }

    // Create new claim session
    try {
      const res = await fetch(
        `${identity.cloudUrl}/api/agents/${identity.agentId}/claim-sessions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: authHeader },
          body: JSON.stringify({}),
        },
      );

      if (!res.ok) {
        const errorBody = await res.text();
        return { status: 'failed', message: `Failed to create claim session: ${res.status} ${errorBody}` };
      }

      const session = (await res.json()) as { id: string };
      const claimUrl = `${identity.cloudUrl}/device/claim/${session.id}`;

      // Persist session state
      storage.setMeta('claim.sessionId', session.id);
      storage.setMeta('claim.url', claimUrl);
      storage.cloudIdentity.updateClaimStatus('pending');

      return { status: 'pending', claimSessionId: session.id, claimUrl, message: 'Login required. Opening browser...' };
    } catch (err) {
      log.error({ err }, 'Failed to create claim session');
      return { status: 'failed', message: (err as Error).message };
    }
  }

  /**
   * Poll an existing claim session. Returns null if session is stale/expired.
   */
  private async pollSession(
    cloudUrl: string,
    agentId: string,
    sessionId: string,
    authHeader: string,
  ): Promise<ClaimResult | null> {
    try {
      const res = await fetch(
        `${cloudUrl}/api/agents/${agentId}/claim-sessions/${sessionId}`,
        { headers: { Authorization: authHeader } },
      );

      if (!res.ok) return null;

      const session = (await res.json()) as {
        status: string;
        approvedByUserId?: string;
        approvedByUser?: { id: string; name: string; email: string };
      };

      if (session.status === 'approved') {
        const user = session.approvedByUser ?? (session.approvedByUserId
          ? { id: session.approvedByUserId, name: '', email: '' }
          : undefined);
        this.persistClaimed(user);
        return { status: 'claimed', user, message: 'Login approved!' };
      }

      if (session.status === 'pending') {
        const storage = getStorage();
        const claimUrl = storage.getMeta('claim.url');
        return { status: 'pending', claimSessionId: sessionId, claimUrl: claimUrl ?? undefined, message: 'Waiting for login approval.' };
      }

      // Expired or other — stale
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Persist claim as "claimed" in local storage.
   */
  persistClaimed(user?: ClaimUser): void {
    const storage = getStorage();
    storage.cloudIdentity.updateClaimStatus('claimed', user?.id, user?.name, user?.email);
    storage.deleteMeta('claim.sessionId');
    storage.deleteMeta('claim.url');
    log.info({ userId: user?.id, email: user?.email }, 'Device claimed by user');

    this.triggerPostClaimAutoShield();
  }

  /**
   * Trigger auto-shield after claim approval if Claude is not yet shielded.
   * Guards against duplicate runs and already-shielded state.
   */
  private triggerPostClaimAutoShield(): void {
    // Guard: check if claude-code profile already exists
    try {
      const storage = getStorage();
      const profiles = storage.profiles.getAll();
      if (profiles.some((p: { presetId?: string }) => p.presetId === 'claude-code')) {
        log.debug('Post-claim auto-shield skipped: claude-code profile already exists');
        return;
      }
    } catch { /* proceed with shield attempt */ }

    import('./auto-shield').then(({ getAutoShieldService }) => {
      const autoShield = getAutoShieldService();
      const state = autoShield.getState().state;
      // Guard: already running or pending
      if (state === 'in_progress' || state === 'pending') {
        log.debug('Post-claim auto-shield skipped: already %s', state);
        return;
      }
      autoShield.run({ force: true }).catch((err) => {
        log.warn({ err }, 'Post-claim auto-shield failed');
      });
    }).catch(() => { /* module not available */ });

    // Emit updated daemon status so UI reflects claim change
    import('../events/emitter').then(({ emitDaemonStatus }) => {
      import('../routes/status').then(({ buildDaemonStatus }) => {
        emitDaemonStatus(buildDaemonStatus());
      });
    }).catch(() => {});
  }

  /**
   * Sync claim state from cloud (called on cloud-connector connect).
   */
  async syncFromCloud(cloudUrl: string, agentId: string, privateKey: string): Promise<void> {
    try {
      const authHeader = createAgentSigHeader(agentId, privateKey);
      const res = await fetch(
        `${cloudUrl}/api/agents/${agentId}/claim`,
        { headers: { Authorization: authHeader } },
      );

      if (!res.ok) return;

      const data = (await res.json()) as {
        status: 'unclaimed' | 'claimed';
        user?: ClaimUser;
      };

      if (data.status === 'claimed' && data.user) {
        const storage = getStorage();
        const identity = storage.cloudIdentity.get();
        if (identity && identity.claimStatus !== 'claimed') {
          this.persistClaimed(data.user);
        }
      }
    } catch (err) {
      log.debug({ err }, 'Failed to sync claim state from cloud');
    }
  }
}
