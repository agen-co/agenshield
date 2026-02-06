/**
 * Activity history route
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { getActivityLog } from '../services/activity-log';
import { isAuthenticated } from '../auth/middleware';

export async function activityRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/activity',
    async (request: FastifyRequest<{ Querystring: { limit?: string } }>) => {
      const authenticated = isAuthenticated(request);
      const raw = Number(request.query.limit) || 500;
      const limit = Math.min(Math.max(raw, 1), 10000);

      const events = getActivityLog().getHistory(limit);

      if (authenticated) {
        return { data: events };
      }

      // Strip event data for anonymous users (same as SSE)
      const stripped = events.map((e) => ({
        type: e.type,
        timestamp: e.timestamp,
        data: {},
      }));
      return { data: stripped };
    },
  );
}
