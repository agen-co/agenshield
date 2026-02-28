/**
 * Activity history route
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { getStorage } from '@agenshield/storage';
import { isAuthenticated } from '../auth/middleware';

/**
 * Telemetry event types to filter from historical API responses.
 * Defence-in-depth: even if older rows exist in the DB, don't expose them.
 */
const TELEMETRY_TYPES: ReadonlySet<string> = new Set([
  'heartbeat',
  'metrics:snapshot',
  'metrics:eventloop',
  'daemon:status',
  'security:status',
  'targets:status',
]);

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

      // Over-fetch to account for telemetry rows that will be filtered out
      const overFetch = limit + 50;
      const rawEvents = getStorage().activities.getAll({ limit: overFetch, profileId });
      const events = rawEvents.filter((e) => !TELEMETRY_TYPES.has(e.type)).slice(0, limit);

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
