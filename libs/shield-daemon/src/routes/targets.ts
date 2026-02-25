/**
 * Profile management routes — CRUD for profiles
 */

import type { FastifyInstance } from 'fastify';
import { getStorage } from '@agenshield/storage';
import { signBrokerToken } from '@agenshield/auth';
import {
  writeTokenFile,
  removeTokenFile,
  invalidateTokenCache,
} from '../services/profile-token';

export async function profileRoutes(app: FastifyInstance): Promise<void> {
  // List all profiles (enriched with per-profile counts)
  app.get('/profiles', async () => {
    const storage = getStorage();
    const profiles = storage.profiles.getAll();
    const enriched = profiles.map((p) => {
      const scoped = storage.for({ profileId: p.id });
      return {
        ...p,
        policiesCount: scoped.policies.getAll().length,
        secretsCount: scoped.secrets.getAll().length,
      };
    });
    return { data: enriched };
  });

  // Create a profile
  app.post('/profiles', async (request) => {
    const storage = getStorage();
    const body = request.body as Record<string, unknown>;

    // Generate JWT broker token for target profiles
    const type = (body.type as string) ?? 'target';
    if (type === 'target') {
      const id = body.id as string;
      const brokerJwt = await signBrokerToken(id, id);
      body.brokerToken = brokerJwt;
    }

    const profile = storage.profiles.create(body);
    invalidateTokenCache();

    // Auto-seed preset policies for this profile
    if (profile.presetId) {
      const scopedPolicies = storage.for({ profileId: profile.id }).policies;
      scopedPolicies.seedPreset(profile.presetId);
    }

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

  // Rotate broker token (generate new JWT)
  app.post<{ Params: { id: string } }>(
    '/profiles/:id/rotate-token',
    async (request) => {
      const storage = getStorage();
      const profile = storage.profiles.getById(request.params.id);
      if (!profile) return { success: false, error: 'Profile not found' };

      // Sign a new broker JWT
      const newJwt = await signBrokerToken(profile.id, profile.id);
      const updated = storage.profiles.update(profile.id, { brokerToken: newJwt });
      invalidateTokenCache();

      // Write new token file
      if (updated?.brokerHomeDir) {
        writeTokenFile(updated.brokerHomeDir, newJwt);
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
