/**
 * OpenClaw lifecycle management routes
 *
 * Dynamic import from @agenshield/sandbox — these exports may not be built yet.
 */

import type { FastifyInstance } from 'fastify';
import type { ApiResponse } from '@agenshield/ipc';

// Lazy-loaded sandbox functions (may not exist in current build)
let _sandbox: Record<string, unknown> | undefined;
async function getSandbox(): Promise<Record<string, unknown>> {
  if (!_sandbox) {
    _sandbox = await import('@agenshield/integrations') as Record<string, unknown>;
  }
  return _sandbox;
}

export async function openclawRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/openclaw/status
  app.get('/openclaw/status', async (): Promise<ApiResponse<unknown>> => {
    try {
      const sandbox = await getSandbox();
      const fn = sandbox['getOpenClawStatus'] as (() => Promise<unknown>) | undefined;
      if (!fn) return { success: false, error: { code: 'OPENCLAW_NOT_AVAILABLE', message: 'OpenClaw functions not available in current build' } };
      const status = await fn();
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
      const sandbox = await getSandbox();
      const fn = sandbox['startOpenClawServices'] as (() => Promise<{ success: boolean; message: string }>) | undefined;
      if (!fn) return { success: false, error: { code: 'OPENCLAW_NOT_AVAILABLE', message: 'OpenClaw functions not available in current build' } };
      const result = await fn();
      if (!result.success) {
        return { success: false, error: { code: 'OPENCLAW_START_ERROR', message: result.message } };
      }
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
      const sandbox = await getSandbox();
      const fn = sandbox['stopOpenClawServices'] as (() => Promise<{ success: boolean; message: string }>) | undefined;
      if (!fn) return { success: false, error: { code: 'OPENCLAW_NOT_AVAILABLE', message: 'OpenClaw functions not available in current build' } };
      const result = await fn();
      if (!result.success) {
        return { success: false, error: { code: 'OPENCLAW_STOP_ERROR', message: result.message } };
      }
      return { success: true, data: { message: result.message } };
    } catch (error) {
      return {
        success: false,
        error: { code: 'OPENCLAW_STOP_ERROR', message: (error as Error).message },
      };
    }
  });

  // POST /api/openclaw/restart
  app.post('/openclaw/restart', async (): Promise<ApiResponse<{ message: string }>> => {
    try {
      const sandbox = await getSandbox();
      const fn = sandbox['restartOpenClawServices'] as (() => Promise<{ success: boolean; message: string }>) | undefined;
      if (!fn) return { success: false, error: { code: 'OPENCLAW_NOT_AVAILABLE', message: 'OpenClaw functions not available in current build' } };
      const result = await fn();
      if (!result.success) {
        return { success: false, error: { code: 'OPENCLAW_RESTART_ERROR', message: result.message } };
      }
      return { success: true, data: { message: result.message } };
    } catch (error) {
      return {
        success: false,
        error: { code: 'OPENCLAW_RESTART_ERROR', message: (error as Error).message },
      };
    }
  });
}
