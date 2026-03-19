/**
 * Status route
 */

import type { FastifyInstance } from 'fastify';
import type { GetStatusResponse, DaemonStatus } from '@agenshield/ipc';
import { VERSION, loadConfig } from '../config/index';
import { loadState } from '../state/index';
import { getCloudConnector } from '../services/cloud-connector';
import { getEnrollmentService } from '../services/enrollment';
import { getActivationService } from '../services/activation';
import { getAutoShieldService } from '../services/auto-shield';
import { getStorage } from '@agenshield/storage';
import { getOpenClawStatusSync, detectHostOpenClawVersion } from '@agenshield/seatbelt';

// Cached OpenClaw version (detected once, doesn't change at runtime)
let cachedOpenClawVersion: string | null | undefined;

/** Build claim status from cloud identity storage */
function buildClaimStatus(): { claim?: DaemonStatus['claim'] } {
  try {
    const storage = getStorage();
    const identity = storage.cloudIdentity.get();
    if (!identity) return {};
    const claim: DaemonStatus['claim'] = {
      status: identity.claimStatus,
      ...(identity.claimStatus === 'claimed' && identity.claimedUserId ? {
        user: {
          id: identity.claimedUserId,
          name: identity.claimedUserName ?? '',
          email: identity.claimedUserEmail ?? '',
        },
      } : {}),
    };
    return { claim };
  } catch {
    return {};
  }
}

export const startedAt = new Date();

export function buildDaemonStatus(): DaemonStatus {
  const config = loadConfig();
  const state = loadState();
  const uptimeMs = Date.now() - startedAt.getTime();
  const uptimeSeconds = Math.floor(uptimeMs / 1000);

  const agentUser = state.users.find((u) => u.type === 'agent');

  // Get OpenClaw status (sync to keep buildDaemonStatus synchronous)
  let openclaw: DaemonStatus['openclaw'] | undefined;
  try {
    openclaw = getOpenClawStatusSync() as DaemonStatus['openclaw'];
  } catch {
    // OpenClaw may not be installed
  }

  // Detect and cache OpenClaw version (once)
  if (cachedOpenClawVersion === undefined) {
    try {
      cachedOpenClawVersion = detectHostOpenClawVersion();
    } catch {
      cachedOpenClawVersion = null;
    }
  }

  if (openclaw && cachedOpenClawVersion !== undefined) {
    openclaw.version = cachedOpenClawVersion;
  }

  // Cloud connection status
  const cloud = getCloudConnector();
  const cloudConnected = cloud.isConnected();
  const cloudCompany = cloud.getCompanyName();

  // Enrollment state
  const enrollmentState = getEnrollmentService().getState();
  const enrollmentPending = enrollmentState.state === 'pending_user_auth';
  const includeEnrollment = enrollmentState.state !== 'idle';

  // Activation state
  const servicesActive = getActivationService().isActive();

  // Auto-shield state
  const autoShieldState = getAutoShieldService().getState();
  const includeAutoShield = autoShieldState.state !== 'idle';

  // Aggregate stats for menu bar
  let stats: DaemonStatus['stats'] | undefined;
  try {
    const storage = getStorage();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    stats = {
      events: storage.activities.count({ since: todayStart.toISOString() }),
      policies: storage.policies.getAll().length,
      skills: storage.skills.getAll().length,
      pendingSkills: storage.workspaceSkills.countByStatus('pending'),
    };
  } catch {
    // Storage may not be initialized yet
  }

  return {
    running: true,
    pid: process.pid,
    uptime: uptimeSeconds,
    version: VERSION,
    port: config.daemon.port,
    startedAt: startedAt.toISOString(),
    agentUsername: agentUser?.username,
    servicesActive,
    ...(stats ? { stats } : {}),
    ...(openclaw ? { openclaw } : {}),
    ...(cloudConnected ? { cloudConnected, cloudCompany } : {}),
    ...(() => {
      try {
        const storage = getStorage();
        if (storage.cloudIdentity.isEnrolled()) {
          const identity = storage.cloudIdentity.get();
          return {
            cloudEnrolled: true as const,
            ...(!cloudCompany && identity?.companyName ? { cloudCompany: identity.companyName } : {}),
          };
        }
        return {};
      } catch {
        return {};
      }
    })(),
    ...(enrollmentPending ? { enrollmentPending } : {}),
    ...(includeEnrollment ? {
      enrollment: {
        state: enrollmentState.state,
        ...('verificationUri' in enrollmentState ? { verificationUri: enrollmentState.verificationUri } : {}),
        ...('userCode' in enrollmentState ? { userCode: enrollmentState.userCode } : {}),
        ...('expiresAt' in enrollmentState ? { expiresAt: enrollmentState.expiresAt } : {}),
        ...('error' in enrollmentState ? { error: enrollmentState.error } : {}),
      },
    } : {}),
    ...(includeAutoShield ? {
      autoShield: {
        state: autoShieldState.state as 'pending' | 'in_progress' | 'complete' | 'failed',
        ...('progress' in autoShieldState ? { progress: autoShieldState.progress } : {}),
        ...('result' in autoShieldState ? { result: autoShieldState.result } : {}),
        ...('error' in autoShieldState ? { error: autoShieldState.error } : {}),
      },
    } : {}),
    ...buildClaimStatus(),
  };
}

export async function statusRoutes(app: FastifyInstance): Promise<void> {
  app.get('/status', async (): Promise<GetStatusResponse> => {
    return {
      success: true,
      data: buildDaemonStatus(),
    };
  });

  app.post('/shutdown', async (_request, reply) => {
    reply.send({ success: true, data: { message: 'Shutting down...' } });
    // Delay so the response is sent before exit
    setTimeout(() => { process.exit(0); }, 500);
  });
}
