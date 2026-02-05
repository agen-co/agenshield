/**
 * Secrets routes — CRUD backed by encrypted vault
 */

import type { FastifyInstance } from 'fastify';
import type { VaultSecret } from '@agenshield/ipc';
import { getVault } from '../vault';
import crypto from 'node:crypto';

interface MaskedSecret {
  id: string;
  name: string;
  policyIds: string[];
  maskedValue: string;
  createdAt: string;
}

function maskValue(value: string): string {
  if (value.length <= 4) return '••••••••';
  return '••••••••' + value.slice(-4);
}

function toMasked(secret: VaultSecret): MaskedSecret {
  return {
    id: secret.id,
    name: secret.name,
    policyIds: secret.policyIds,
    maskedValue: maskValue(secret.value),
    createdAt: secret.createdAt,
  };
}

export async function secretsRoutes(app: FastifyInstance): Promise<void> {
  // List all secrets (values masked)
  app.get('/secrets', async () => {
    const vault = getVault();
    const secrets = (await vault.get('secrets')) ?? [];
    return { data: secrets.map(toMasked) };
  });

  // Create a new secret
  app.post<{ Body: { name: string; value: string; policyIds: string[] } }>(
    '/secrets',
    async (request) => {
      const { name, value, policyIds } = request.body;

      if (!name?.trim() || !value?.trim()) {
        return { success: false, error: 'Name and value are required' };
      }

      const vault = getVault();
      const secrets = (await vault.get('secrets')) ?? [];

      const newSecret: VaultSecret = {
        id: crypto.randomUUID(),
        name: name.trim(),
        value,
        policyIds: policyIds ?? [],
        createdAt: new Date().toISOString(),
      };

      secrets.push(newSecret);
      await vault.set('secrets', secrets);

      return { data: toMasked(newSecret) };
    }
  );

  // Update a secret (e.g. policyIds)
  app.patch<{ Params: { id: string }; Body: { policyIds: string[] } }>(
    '/secrets/:id',
    async (request) => {
      const { id } = request.params;
      const { policyIds } = request.body;
      const vault = getVault();
      const secrets = (await vault.get('secrets')) ?? [];
      const idx = secrets.findIndex((s) => s.id === id);
      if (idx === -1) return { success: false, error: 'Secret not found' };
      secrets[idx].policyIds = policyIds ?? [];
      await vault.set('secrets', secrets);
      return { data: toMasked(secrets[idx]) };
    }
  );

  // Delete a secret
  app.delete<{ Params: { id: string } }>(
    '/secrets/:id',
    async (request) => {
      const { id } = request.params;
      const vault = getVault();
      const secrets = (await vault.get('secrets')) ?? [];
      const filtered = secrets.filter((s) => s.id !== id);

      if (filtered.length === secrets.length) {
        return { success: false, error: 'Secret not found' };
      }

      await vault.set('secrets', filtered);
      return { deleted: true };
    }
  );
}
