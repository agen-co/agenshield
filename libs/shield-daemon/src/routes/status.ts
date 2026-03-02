/**
 * Status route
 */

import type { FastifyInstance } from 'fastify';
import type { GetStatusResponse, DaemonStatus } from '@agenshield/ipc';
import { VERSION, loadConfig } from '../config/index';
import { loadState } from '../state/index';
import { getCloudConnector } from '../services/cloud-connector';
import { getEnrollmentService } from '../services/enrollment';

// Lazy-loaded integrations — avoids top-level await (TLA) which breaks CJS bundles
let getOpenClawStatusSync: (() => unknown) | undefined;
let detectHostOpenClawVersion: (() => string | null) | undefined;
let _integrationsLoaded = false;

function ensureIntegrations(): void {
  if (_integrationsLoaded) return;
  _integrationsLoaded = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const integrations = require('@agenshield/integrations') as Record<string, unknown>;
    getOpenClawStatusSync = integrations['getOpenClawStatusSync'] as typeof getOpenClawStatusSync;
    detectHostOpenClawVersion = integrations['detectHostOpenClawVersion'] as typeof detectHostOpenClawVersion;
  } catch {
    // @agenshield/integrations may not be available
  }
}

// Cached OpenClaw version (detected once, doesn't change at runtime)
let cachedOpenClawVersion: string | null | undefined;

export const startedAt = new Date();

export function buildDaemonStatus(): DaemonStatus {
  ensureIntegrations();
  const config = loadConfig();
  const state = loadState();
  const uptimeMs = Date.now() - startedAt.getTime();
  const uptimeSeconds = Math.floor(uptimeMs / 1000);

  const agentUser = state.users.find((u) => u.type === 'agent');

  // Get OpenClaw status (sync to keep buildDaemonStatus synchronous)
  let openclaw: DaemonStatus['openclaw'] | undefined;
  try {
    if (getOpenClawStatusSync) {
      openclaw = getOpenClawStatusSync() as DaemonStatus['openclaw'];
    }
  } catch {
    // OpenClaw may not be installed
  }

  // Detect and cache OpenClaw version (once)
  if (cachedOpenClawVersion === undefined && detectHostOpenClawVersion) {
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

  return {
    running: true,
    pid: process.pid,
    uptime: uptimeSeconds,
    version: VERSION,
    port: config.daemon.port,
    startedAt: startedAt.toISOString(),
    agentUsername: agentUser?.username,
    ...(openclaw ? { openclaw } : {}),
    ...(cloudConnected ? { cloudConnected, cloudCompany } : {}),
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
  };
}

export async function statusRoutes(app: FastifyInstance): Promise<void> {
  app.get('/status', async (): Promise<GetStatusResponse> => {
    return {
      success: true,
      data: buildDaemonStatus(),
    };
  });
}
