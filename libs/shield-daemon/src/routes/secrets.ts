/**
 * Secrets routes — CRUD backed by encrypted vault
 */

import type { FastifyInstance } from 'fastify';
import type { VaultSecret, SecretScope, SkillEnvRequirement } from '@agenshield/ipc';
import { isSecretEnvVar } from '@agenshield/sandbox';
import { getVault } from '../vault';
import { loadConfig } from '../config/index';
import { syncSecrets } from '../secret-sync';
import { getCachedAnalysis } from '../services/skill-analyzer';
import { getDownloadedSkillMeta } from '../services/marketplace';
import { listApproved, getSkillsDir } from '../watchers/skills';
import crypto from 'node:crypto';
import fs from 'node:fs';

interface MaskedSecret {
  id: string;
  name: string;
  policyIds: string[];
  maskedValue: string;
  createdAt: string;
  scope: SecretScope;
}

function maskValue(value: string): string {
  if (value.length <= 4) return '••••••••';
  return '••••••••' + value.slice(-4);
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
    maskedValue: maskValue(secret.value),
    createdAt: secret.createdAt,
    scope: resolveScope(secret),
  };
}

export async function secretsRoutes(app: FastifyInstance): Promise<void> {
  // List all secrets (values masked)
  app.get('/secrets', async () => {
    const vault = getVault();
    const secrets = (await vault.get('secrets')) ?? [];
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

  // Aggregate env variables required by installed skills
  app.get('/secrets/skill-env', async () => {
    const approved = listApproved();
    const vault = getVault();
    const secrets = (await vault.get('secrets')) ?? [];

    // Build vault lookup by name
    const secretByName = new Map<string, VaultSecret>();
    for (const s of secrets) {
      secretByName.set(s.name, s);
    }

    // Collect all skill names (approved + workspace on-disk)
    const approvedNames = new Set(approved.map((a) => a.name));
    const skillsDir = getSkillsDir();
    let workspaceNames: string[] = [];
    if (skillsDir) {
      try {
        workspaceNames = fs.readdirSync(skillsDir, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name)
          .filter((n) => !approvedNames.has(n));
      } catch {
        // Skills directory may not exist yet
      }
    }

    // Aggregate env vars from cached analyses
    const envMap = new Map<string, SkillEnvRequirement>();

    const allSkills = [
      ...approved.map((a) => ({ name: a.name, slug: a.slug })),
      ...workspaceNames.map((n) => ({ name: n, slug: undefined })),
    ];

    for (const skill of allSkills) {
      const cached = getCachedAnalysis(skill.name);
      const dlMeta = getDownloadedSkillMeta(skill.slug || skill.name);
      const analysis = dlMeta?.analysis || cached;
      if (!analysis || analysis.status !== 'complete' || !Array.isArray(analysis.envVariables)) {
        continue;
      }

      for (const ev of analysis.envVariables) {
        const existing = envMap.get(ev.name);
        if (existing) {
          // Merge: aggregate requiredBy, escalate required/sensitive
          existing.requiredBy.push({ skillName: skill.name });
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
            requiredBy: [{ skillName: skill.name }],
            fulfilled: !!vaultSecret,
            existingSecretScope: vaultSecret ? resolveScope(vaultSecret) : undefined,
            existingSecretId: vaultSecret?.id,
          });
        }
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

  // Create a new secret
  app.post<{ Body: { name: string; value: string; policyIds: string[]; scope?: SecretScope } }>(
    '/secrets',
    async (request) => {
      const { name, value, policyIds, scope } = request.body;

      if (!name?.trim() || !value?.trim()) {
        return { success: false, error: 'Name and value are required' };
      }

      const vault = getVault();
      const secrets = (await vault.get('secrets')) ?? [];

      const resolvedScope = scope ?? (policyIds?.length > 0 ? 'policed' : 'global');

      const newSecret: VaultSecret = {
        id: crypto.randomUUID(),
        name: name.trim(),
        value,
        policyIds: resolvedScope === 'standalone' ? [] : (policyIds ?? []),
        createdAt: new Date().toISOString(),
        scope: resolvedScope,
      };

      secrets.push(newSecret);
      await vault.set('secrets', secrets);

      // Sync secrets to broker (skip for standalone — not injected)
      if (resolvedScope !== 'standalone') {
        syncSecrets(loadConfig().policies).catch(() => { /* non-fatal */ });
      }

      return { data: toMasked(newSecret) };
    }
  );

  // Update a secret (e.g. policyIds, scope)
  app.patch<{ Params: { id: string }; Body: { policyIds?: string[]; scope?: SecretScope } }>(
    '/secrets/:id',
    async (request) => {
      const { id } = request.params;
      const { policyIds, scope } = request.body;
      const vault = getVault();
      const secrets = (await vault.get('secrets')) ?? [];
      const idx = secrets.findIndex((s) => s.id === id);
      if (idx === -1) return { success: false, error: 'Secret not found' };

      if (scope !== undefined) {
        secrets[idx].scope = scope;
        if (scope === 'standalone') {
          secrets[idx].policyIds = [];
        }
      }
      if (policyIds !== undefined && secrets[idx].scope !== 'standalone') {
        secrets[idx].policyIds = policyIds;
      }

      await vault.set('secrets', secrets);

      // Always re-sync (scope changes may add/remove from synced-secrets.json)
      syncSecrets(loadConfig().policies).catch(() => { /* non-fatal */ });

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

      // Sync secrets to broker
      syncSecrets(loadConfig().policies).catch(() => { /* non-fatal */ });

      return { deleted: true };
    }
  );
}
