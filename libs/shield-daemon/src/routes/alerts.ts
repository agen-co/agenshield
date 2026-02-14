/**
 * Alerts API routes
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { getStorage } from '@agenshield/storage';
import { isAuthenticated } from '../auth/middleware';
import { daemonEvents, type DaemonEvent } from '../events/emitter';

export async function alertsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /alerts — List alerts
   * Query params: limit, include_acknowledged, severity
   */
  app.get(
    '/alerts',
    async (request: FastifyRequest<{
      Querystring: { limit?: string; include_acknowledged?: string; severity?: string }
    }>) => {
      const raw = Number(request.query.limit) || 100;
      const limit = Math.min(Math.max(raw, 1), 1000);
      const includeAcknowledged = request.query.include_acknowledged === 'true';
      const severity = request.query.severity || undefined;

      const alerts = getStorage().alerts.getAll({ limit, includeAcknowledged, severity });
      const unacknowledgedCount = getStorage().alerts.count();

      return {
        data: alerts,
        meta: { unacknowledgedCount },
      };
    },
  );

  /**
   * GET /alerts/count — Lightweight unacknowledged count
   */
  app.get('/alerts/count', async () => {
    const count = getStorage().alerts.count();
    return { data: { count } };
  });

  /**
   * POST /alerts/:id/acknowledge — Acknowledge one alert
   */
  app.post(
    '/alerts/:id/acknowledge',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      if (!isAuthenticated(request)) {
        return reply.status(403).send({
          success: false,
          error: { message: 'Authentication required to acknowledge alerts', statusCode: 403 },
        });
      }

      const id = Number(request.params.id);
      if (!id || isNaN(id)) {
        return reply.status(400).send({
          success: false,
          error: { message: 'Invalid alert ID', statusCode: 400 },
        });
      }

      const acknowledged = getStorage().alerts.acknowledge(id);
      if (!acknowledged) {
        return reply.status(404).send({
          success: false,
          error: { message: 'Alert not found or already acknowledged', statusCode: 404 },
        });
      }

      daemonEvents.broadcast('alerts:acknowledged' as DaemonEvent['type'], { alertId: id });

      return { success: true, data: { id } };
    },
  );

  /**
   * POST /alerts/acknowledge-all — Acknowledge all unacknowledged alerts
   */
  app.post('/alerts/acknowledge-all', async (request, reply) => {
    if (!isAuthenticated(request)) {
      return reply.status(403).send({
        success: false,
        error: { message: 'Authentication required to acknowledge alerts', statusCode: 403 },
      });
    }

    const count = getStorage().alerts.acknowledgeAll();

    daemonEvents.broadcast('alerts:acknowledged' as DaemonEvent['type'], { alertId: -1 });

    return { success: true, data: { count } };
  });
}
