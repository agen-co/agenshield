/**
 * Secrets routes — CRUD backed by SQLite storage
 *
 * Secrets are encrypted at rest (AES-256-GCM). Write operations (create/update value)
 * require the vault to be unlocked; reads return masked values regardless of lock state.
 *
 * Routes use scoped storage derived from the request's ShieldContext headers.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { VaultSecret, SecretScope, SkillEnvRequirement, ScopeFilter } from '@agenshield/ipc';
import { contextToScope } from '@agenshield/ipc';
import { isSecretEnvVar } from '@agenshield/sandbox';
import { getStorage, StorageLockedError } from '@agenshield/storage';
import type { SecretsRepository } from '@agenshield/storage';
import { loadConfig } from '../config/index';
import { syncSecrets } from '../secret-sync';
import { getDownloadedSkillMeta } from '../services/marketplace';
import { getSkillsDir } from '../config/paths';
import fs from 'node:fs';

interface MaskedSecret {
  id: string;
  name: string;
  policyIds: string[];
  maskedValue: string;
  createdAt: string;
  scope: SecretScope;
}

function resolveScope(secret: VaultSecret): SecretScope {
  if (secret.scope) return secret.scope;
  return secret.policyIds.length > 0 ? 'policed' : 'global';
}

function toMasked(secret: VaultSecret): MaskedSecret {
  return {
    id: secret.id,
    name: secret.name,
    policyIds: secret.policyIds,
    maskedValue: secret.value, // Already masked by getAllMasked()
    createdAt: secret.createdAt,
    scope: resolveScope(secret),
  };
}

/**
 * Get a scoped SecretsRepository based on request context headers.
 */
function getScopedSecrets(request: FastifyRequest): SecretsRepository {
  const scope: ScopeFilter = contextToScope(request.shieldContext);
  if (scope.profileId) {
    return getStorage().for(scope).secrets;
  }
  return getStorage().secrets;
}

export async function secretsRoutes(app: FastifyInstance): Promise<void> {
  // List all secrets (values masked — works when vault is locked)
  app.get('/secrets', async (request) => {
    const secrets = getScopedSecrets(request).getAllMasked();
    return { data: secrets.map(toMasked) };
  });

  // List env var NAMES matching secret patterns (names only, never values)
  app.get('/secrets/env', async () => {
    const names = new Set<string>();

    // Scan daemon's process.env
    for (const key of Object.keys(process.env)) {
      if (process.env[key] && isSecretEnvVar(key)) {
        names.add(key);
      }
    }

    // Merge AGENSHIELD_USER_SECRETS (calling user's secret names, set at daemon start)
    const userSecrets = process.env['AGENSHIELD_USER_SECRETS'];
    if (userSecrets) {
      for (const name of userSecrets.split(',').filter(Boolean)) {
        names.add(name);
      }
    }

    return { data: Array.from(names).sort((a, b) => a.localeCompare(b)) };
  });

  // Aggregate env variables required by installed skills (works when locked)
  app.get('/secrets/skill-env', async (request) => {
    const repo = app.skillManager.getRepository();
    const secrets = getScopedSecrets(request).getAllMasked();

    // Build lookup by name
    const secretByName = new Map<string, VaultSecret>();
    for (const s of secrets) {
      secretByName.set(s.name, s);
    }

    // Aggregate env vars from DB skill analyses + marketplace download metadata
    const envMap = new Map<string, SkillEnvRequirement>();

    // All skills from DB
    const allDbSkills = repo.getAll();
    const knownSlugs = new Set<string>();

    for (const skill of allDbSkills) {
      knownSlugs.add(skill.slug);
      const version = repo.getLatestVersion(skill.id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const analysisJson = version?.analysisJson as any;
      const dlMeta = getDownloadedSkillMeta(skill.slug);
      const analysis = analysisJson ?? dlMeta?.analysis;

      if (!analysis || analysis.status !== 'complete' || !Array.isArray(analysis.envVariables)) {
        continue;
      }

      for (const ev of analysis.envVariables) {
        const existing = envMap.get(ev.name);
        if (existing) {
          existing.requiredBy.push({ skillName: skill.slug });
          if (ev.required) existing.required = true;
          if (ev.sensitive) existing.sensitive = true;
          if (!existing.purpose && ev.purpose) existing.purpose = ev.purpose;
        } else {
          const vaultSecret = secretByName.get(ev.name);
          envMap.set(ev.name, {
            name: ev.name,
            required: ev.required,
            sensitive: ev.sensitive,
            purpose: ev.purpose ?? '',
            requiredBy: [{ skillName: skill.slug }],
            fulfilled: !!vaultSecret,
            existingSecretScope: vaultSecret ? resolveScope(vaultSecret) : undefined,
            existingSecretId: vaultSecret?.id,
          });
        }
      }
    }

    // Also check workspace on-disk skills not yet in DB
    const skillsDir = getSkillsDir();
    if (skillsDir) {
      try {
        const onDiskNames = fs.readdirSync(skillsDir, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name)
          .filter((n) => !knownSlugs.has(n));

        for (const name of onDiskNames) {
          const dlMeta = getDownloadedSkillMeta(name);
          const analysis = dlMeta?.analysis;
          if (!analysis || analysis.status !== 'complete' || !Array.isArray(analysis.envVariables)) {
            continue;
          }

          for (const ev of analysis.envVariables) {
            const existing = envMap.get(ev.name);
            if (existing) {
              existing.requiredBy.push({ skillName: name });
              if (ev.required) existing.required = true;
              if (ev.sensitive) existing.sensitive = true;
              if (!existing.purpose && ev.purpose) existing.purpose = ev.purpose;
            } else {
              const vaultSecret = secretByName.get(ev.name);
              envMap.set(ev.name, {
                name: ev.name,
                required: ev.required,
                sensitive: ev.sensitive,
                purpose: ev.purpose ?? '',
                requiredBy: [{ skillName: name }],
                fulfilled: !!vaultSecret,
                existingSecretScope: vaultSecret ? resolveScope(vaultSecret) : undefined,
                existingSecretId: vaultSecret?.id,
              });
            }
          }
        }
      } catch {
        // Skills directory may not exist yet
      }
    }

    // Sort: unfulfilled+required first, then unfulfilled, then fulfilled, then alpha
    const result = Array.from(envMap.values()).sort((a, b) => {
      const aScore = (a.fulfilled ? 2 : 0) + (a.required ? 0 : 1);
      const bScore = (b.fulfilled ? 2 : 0) + (b.required ? 0 : 1);
      if (aScore !== bScore) return aScore - bScore;
      return a.name.localeCompare(b.name);
    });

    return { data: result };
  });

  // Create a new secret (requires vault unlocked for encryption)
  app.post<{ Body: { name: string; value: string; policyIds: string[]; scope?: SecretScope } }>(
    '/secrets',
    async (request, reply) => {
      const { name, value, policyIds, scope } = request.body;

      if (!name?.trim() || !value?.trim()) {
        return { success: false, error: 'Name and value are required' };
      }

      const resolvedScope = scope ?? (policyIds?.length > 0 ? 'policed' : 'global');

      try {
        const newSecret = getScopedSecrets(request).create({
          name: name.trim(),
          value,
          scope: resolvedScope,
          policyIds: resolvedScope === 'standalone' ? [] : (policyIds ?? []),
        });

        // Sync secrets to broker (skip for standalone — not injected)
        if (resolvedScope !== 'standalone') {
          syncSecrets(loadConfig().policies).catch(() => { /* non-fatal */ });
        }

        return { data: toMasked(newSecret) };
      } catch (err) {
        if (err instanceof StorageLockedError) {
          request.log.warn({ secret: name, op: 'create' }, 'Vault locked — cannot create secret');
          return reply.status(423).send({ success: false, error: 'Vault is locked. Unlock to create secrets.' });
        }
        throw err;
      }
    }
  );

  // Update a secret (scope, policyIds, value). Value changes require vault unlocked.
  app.patch<{ Params: { id: string }; Body: { value?: string; policyIds?: string[]; scope?: SecretScope } }>(
    '/secrets/:id',
    async (request, reply) => {
      const { id } = request.params;
      const { value, policyIds, scope } = request.body;

      try {
        const updated = getScopedSecrets(request).update(id, { value, policyIds, scope });
        if (!updated) return { success: false, error: 'Secret not found' };

        // Always re-sync (scope/value changes may affect broker)
        syncSecrets(loadConfig().policies).catch(() => { /* non-fatal */ });

        return { data: toMasked(updated) };
      } catch (err) {
        if (err instanceof StorageLockedError) {
          request.log.warn({ secretId: id, op: 'update' }, 'Vault locked — cannot update secret value');
          return reply.status(423).send({ success: false, error: 'Vault is locked. Unlock to update secret values.' });
        }
        throw err;
      }
    }
  );

  // Delete a secret
  app.delete<{ Params: { id: string } }>(
    '/secrets/:id',
    async (request) => {
      const { id } = request.params;
      const deleted = getScopedSecrets(request).delete(id);

      if (!deleted) {
        return { success: false, error: 'Secret not found' };
      }

      // Sync secrets to broker
      syncSecrets(loadConfig().policies).catch(() => { /* non-fatal */ });

      return { deleted: true };
    }
  );
}
