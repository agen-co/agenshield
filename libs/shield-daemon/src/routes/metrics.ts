/**
 * System metrics route — returns live CPU, memory, disk, and network stats.
 *
 * GET /metrics
 */

import os from 'node:os';
import type { FastifyInstance } from 'fastify';
import { getStorage } from '@agenshield/storage';
import {
  measureCpuPercent,
  getDiskPercent,
  getNetThroughput,
  getActiveUser,
} from '../services/metrics-utils';

/* ---- Route ---- */

export async function metricsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/metrics', async () => {
    const [cpuPercent, diskPercent, net] = await Promise.all([
      measureCpuPercent(),
      Promise.resolve(getDiskPercent()),
      Promise.resolve(getNetThroughput()),
    ]);

    const total = os.totalmem();
    const free = os.freemem();
    const memPercent = Math.round((1 - free / total) * 10000) / 100;

    return {
      success: true,
      data: {
        cpuPercent,
        memPercent,
        diskPercent,
        netUp: net.netUp,
        netDown: net.netDown,
        // System info
        hostname: os.hostname(),
        platform: os.platform(),
        arch: os.arch(),
        uptime: Math.floor(os.uptime()),
        activeUser: getActiveUser(),
        cpuModel: os.cpus()[0]?.model ?? 'unknown',
        totalMemory: total,
        nodeVersion: process.version,
      },
    };
  });

  /**
   * GET /metrics/history — Return persisted metrics history.
   * Optional `targetId` query param filters to per-target snapshots.
   */
  app.get<{
    Querystring: { limit?: string; since?: string; targetId?: string };
  }>('/metrics/history', async (request) => {
    const limit = Math.min(Number(request.query.limit) || 150, 500);
    const since = Number(request.query.since) || 0;
    const targetId = request.query.targetId || undefined;

    try {
      const storage = getStorage();
      let snapshots;
      if (targetId) {
        snapshots = since > 0
          ? storage.metrics.getSinceForTarget(targetId, since, limit)
          : storage.metrics.getRecentForTarget(targetId, limit);
      } else {
        snapshots = since > 0
          ? storage.metrics.getSince(since, limit)
          : storage.metrics.getRecent(limit);
      }

      return { success: true, data: snapshots };
    } catch {
      return { success: true, data: [] };
    }
  });
}
