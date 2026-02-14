/**
 * Profile management routes — CRUD for profiles
 */

import type { FastifyInstance } from 'fastify';
import { getStorage } from '@agenshield/storage';

export async function profileRoutes(app: FastifyInstance): Promise<void> {
  // List all profiles
  app.get('/profiles', async () => {
    const storage = getStorage();
    const profiles = storage.profiles.getAll();
    return { data: profiles };
  });

  // Create a profile
  app.post('/profiles', async (request) => {
    const profile = getStorage().profiles.create(request.body);
    return { data: profile };
  });

  // Update a profile
  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/profiles/:id',
    async (request) => {
      const updated = getStorage().profiles.update(request.params.id, request.body);
      if (!updated) return { success: false, error: 'Profile not found' };
      return { data: updated };
    },
  );

  // Delete a profile (CASCADE deletes scoped policies, secrets, etc.)
  app.delete<{ Params: { id: string } }>(
    '/profiles/:id',
    async (request) => {
      const deleted = getStorage().profiles.delete(request.params.id);
      return { deleted };
    },
  );
}
