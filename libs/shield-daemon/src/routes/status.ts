/**
 * Status route
 */

import type { FastifyInstance } from 'fastify';
import type { GetStatusResponse } from '@agenshield/ipc';
import { VERSION, loadConfig } from '../config/index';
import { loadState } from '../state/index';

const startedAt = new Date();

export async function statusRoutes(app: FastifyInstance): Promise<void> {
  app.get('/status', async (): Promise<GetStatusResponse> => {
    const config = loadConfig();
    const state = loadState();
    const uptimeMs = Date.now() - startedAt.getTime();
    const uptimeSeconds = Math.floor(uptimeMs / 1000);

    const agentUser = state.users.find((u) => u.type === 'agent');
    const wsGroup = state.groups.find((g) => g.type === 'workspace');

    return {
      success: true,
      data: {
        running: true,
        pid: process.pid,
        uptime: uptimeSeconds,
        version: VERSION,
        port: config.daemon.port,
        startedAt: startedAt.toISOString(),
        agentUsername: agentUser?.username,
        workspaceGroup: wsGroup?.name,
      },
    };
  });
}
