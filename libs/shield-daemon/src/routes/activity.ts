/**
 * Activity history route
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { getStorage } from '@agenshield/storage';
import { isAuthenticated } from '../auth/middleware';

export async function activityRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/activity',
    async (request: FastifyRequest<{ Querystring: { limit?: string; profileId?: string } }>) => {
      const authenticated = await isAuthenticated(request);
      const raw = Number(request.query.limit) || 500;
      const limit = Math.min(Math.max(raw, 1), 10000);
      const profileId = request.query.profileId
        || (request.headers['x-shield-profile-id'] as string | undefined)
        || undefined;

      const events = getStorage().activities.getAll({ limit, profileId });

      // Authenticated → full data
      if (authenticated) {
        return { data: events };
      }

      // Strip event data for anonymous users
      const stripped = events.map((e) => ({
        id: e.id,
        type: e.type,
        timestamp: e.timestamp,
        data: {},
        createdAt: e.createdAt,
      }));
      return { data: stripped };
    },
  );
}
