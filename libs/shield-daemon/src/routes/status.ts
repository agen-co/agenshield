/**
 * Status route
 */

import type { FastifyInstance } from 'fastify';
import type { GetStatusResponse, DaemonStatus } from '@agenshield/ipc';
import { VERSION, loadConfig } from '../config/index';
import { loadState } from '../state/index';

// Dynamic import — openclaw-launchdaemon may not be built yet
let getOpenClawStatusSync: (() => unknown) | undefined;
try {
  const integrations = await import('@agenshield/integrations');
  getOpenClawStatusSync = (integrations as Record<string, unknown>)['getOpenClawStatusSync'] as typeof getOpenClawStatusSync;
} catch {
  // @agenshield/sandbox may not export this yet
}

export const startedAt = new Date();

export function buildDaemonStatus(): DaemonStatus {
  const config = loadConfig();
  const state = loadState();
  const uptimeMs = Date.now() - startedAt.getTime();
  const uptimeSeconds = Math.floor(uptimeMs / 1000);

  const agentUser = state.users.find((u) => u.type === 'agent');
  const wsGroup = state.groups.find((g) => g.type === 'workspace');

  // Get OpenClaw status (sync to keep buildDaemonStatus synchronous)
  let openclaw: DaemonStatus['openclaw'] | undefined;
  try {
    if (getOpenClawStatusSync) {
      openclaw = getOpenClawStatusSync() as DaemonStatus['openclaw'];
    }
  } catch {
    // OpenClaw may not be installed
  }

  return {
    running: true,
    pid: process.pid,
    uptime: uptimeSeconds,
    version: VERSION,
    port: config.daemon.port,
    startedAt: startedAt.toISOString(),
    agentUsername: agentUser?.username,
    workspaceGroup: wsGroup?.name,
    ...(openclaw ? { openclaw } : {}),
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
