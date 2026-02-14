/**
 * Profile management routes — CRUD for profiles
 */

import type { FastifyInstance } from 'fastify';
import { getStorage } from '@agenshield/storage';
import {
  writeTokenFile,
  removeTokenFile,
  invalidateTokenCache,
} from '../services/profile-token';

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
    invalidateTokenCache();

    // Write token file for target profiles
    if (profile.type === 'target' && profile.brokerToken && profile.brokerHomeDir) {
      writeTokenFile(profile.brokerHomeDir, profile.brokerToken);
    }

    // Start per-profile socket if socket manager is available
    if (app.profileSocketManager) {
      await app.profileSocketManager.onProfileCreated(profile);
    }

    return { data: profile };
  });

  // Update a profile
  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/profiles/:id',
    async (request) => {
      const updated = getStorage().profiles.update(request.params.id, request.body);
      if (!updated) return { success: false, error: 'Profile not found' };
      invalidateTokenCache();
      return { data: updated };
    },
  );

  // Rotate broker token
  app.post<{ Params: { id: string } }>(
    '/profiles/:id/rotate-token',
    async (request) => {
      const storage = getStorage();
      const updated = storage.profiles.rotateToken(request.params.id);
      if (!updated) return { success: false, error: 'Profile not found' };
      invalidateTokenCache();

      // Write new token file
      if (updated.brokerToken && updated.brokerHomeDir) {
        writeTokenFile(updated.brokerHomeDir, updated.brokerToken);
      }

      return { data: updated };
    },
  );

  // Delete a profile (CASCADE deletes scoped policies, secrets, etc.)
  app.delete<{ Params: { id: string } }>(
    '/profiles/:id',
    async (request) => {
      const storage = getStorage();
      const profile = storage.profiles.getById(request.params.id);
      const deleted = storage.profiles.delete(request.params.id);

      if (deleted) {
        invalidateTokenCache();

        // Clean up token file and socket
        if (profile?.brokerHomeDir) {
          removeTokenFile(profile.brokerHomeDir);
          if (app.profileSocketManager) {
            await app.profileSocketManager.onProfileDeleted(request.params.id, profile.brokerHomeDir);
          }
        }
      }

      return { deleted };
    },
  );
}
