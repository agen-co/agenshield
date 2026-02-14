/**
 * Activity history route
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { getStorage } from '@agenshield/storage';
import { isAuthenticated, isVaultUnlocked } from '../auth/middleware';

export async function activityRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/activity',
    async (request: FastifyRequest<{ Querystring: { limit?: string } }>) => {
      const authenticated = isAuthenticated(request);
      const vaultOpen = isVaultUnlocked();
      const raw = Number(request.query.limit) || 500;
      const limit = Math.min(Math.max(raw, 1), 10000);

      const events = getStorage().activities.getAll({ limit });

      // Authenticated AND vault unlocked → full data
      if (authenticated && vaultOpen) {
        return { data: events };
      }

      // Strip event data for anonymous users or when vault is locked
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
