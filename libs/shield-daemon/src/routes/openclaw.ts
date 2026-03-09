/**
 * OpenClaw lifecycle management routes
 */

import type { FastifyInstance } from 'fastify';
import type { ApiResponse } from '@agenshield/ipc';
import { emitProcessStarted, emitProcessStopped, emitProcessRestarted } from '../events/emitter';
import { resolveTargetContext } from '../services/target-context';
import {
  getOpenClawStatus,
  startOpenClawServices,
  stopOpenClawServices,
  restartOpenClawServices,
  getOpenClawDashboardUrl,
} from '@agenshield/seatbelt';

export async function openclawRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/openclaw/status
  app.get('/openclaw/status', async (): Promise<ApiResponse<unknown>> => {
    try {
      const status = await getOpenClawStatus();
      return { success: true, data: status };
    } catch (error) {
      return {
        success: false,
        error: { code: 'OPENCLAW_STATUS_ERROR', message: (error as Error).message },
      };
    }
  });

  // POST /api/openclaw/start
  app.post('/openclaw/start', async (): Promise<ApiResponse<{ message: string }>> => {
    try {
      const result = await startOpenClawServices();
      if (!result.success) {
        return { success: false, error: { code: 'OPENCLAW_START_ERROR', message: result.message } };
      }
      emitProcessStarted('gateway', {});
      return { success: true, data: { message: result.message } };
    } catch (error) {
      return {
        success: false,
        error: { code: 'OPENCLAW_START_ERROR', message: (error as Error).message },
      };
    }
  });

  // POST /api/openclaw/stop
  app.post('/openclaw/stop', async (): Promise<ApiResponse<{ message: string }>> => {
    try {
      const result = await stopOpenClawServices();
      if (!result.success) {
        return { success: false, error: { code: 'OPENCLAW_STOP_ERROR', message: result.message } };
      }
      emitProcessStopped('gateway', {});
      return { success: true, data: { message: result.message } };
    } catch (error) {
      return {
        success: false,
        error: { code: 'OPENCLAW_STOP_ERROR', message: (error as Error).message },
      };
    }
  });

  // GET /api/openclaw/dashboard-url
  app.get('/openclaw/dashboard-url', async (): Promise<ApiResponse<{ url: string; token: string }>> => {
    try {
      const targetCtx = resolveTargetContext('openclaw');
      if (!targetCtx) {
        return { success: false, error: { code: 'TARGET_CONTEXT_NOT_FOUND', message: 'No target context configured' } };
      }
      const result = await getOpenClawDashboardUrl({ agentHome: targetCtx.agentHome });
      if (!result.success || !result.url || !result.token) {
        return { success: false, error: { code: 'OPENCLAW_DASHBOARD_ERROR', message: result.error || 'Failed to get dashboard URL' } };
      }
      return { success: true, data: { url: result.url, token: result.token } };
    } catch (error) {
      return {
        success: false,
        error: { code: 'OPENCLAW_DASHBOARD_ERROR', message: (error as Error).message },
      };
    }
  });

  // POST /api/openclaw/restart
  app.post('/openclaw/restart', async (): Promise<ApiResponse<{ message: string }>> => {
    try {
      const result = await restartOpenClawServices();
      if (!result.success) {
        return { success: false, error: { code: 'OPENCLAW_RESTART_ERROR', message: result.message } };
      }
      emitProcessRestarted('gateway', {});
      return { success: true, data: { message: result.message } };
    } catch (error) {
      return {
        success: false,
        error: { code: 'OPENCLAW_RESTART_ERROR', message: (error as Error).message },
      };
    }
  });
}
