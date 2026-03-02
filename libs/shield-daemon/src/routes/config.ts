/**
 * Configuration routes
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type {
  GetConfigResponse,
  UpdateConfigResponse,
  UpdateConfigRequest,
  GetTieredPoliciesResponse,
  PolicyConfig,
  ApiResponse,
} from '@agenshield/ipc';
import { AGENCO_PRESET, getPresetById } from '@agenshield/ipc';
import { loadConfig, loadScopedConfig, updateConfig, updateScopedConfig, saveConfig, getDefaultConfig, clearConfigCache } from '../config/index';
import { getStorage } from '@agenshield/storage';
import { getDefaultState, loadState, saveState } from '../state/index';
import { getVault } from '../vault';
import { isAuthenticated } from '../auth/middleware';
import { redactConfig } from '../auth/redact';
import { syncFilesystemPolicyAcls } from '../acl';
import { syncCommandPoliciesAndWrappers } from '../command-sync';
import { syncSecrets } from '../secret-sync';
import { syncOpenClawFromPolicies } from '../services/openclaw-config';
import { installShieldExec, createUserConfig } from '@agenshield/sandbox';
import { generatePolicyMarkdown } from '../services/policy-markdown';
import { resolveTargetContext } from '../services/target-context';
import { syncAndWriteRouterHostPassthrough } from '../services/router-sync';
import { restartProcessEnforcer } from '../services/process-enforcer';
import { getPolicyManager, hasPolicyManager } from '../services/policy-manager';
import {
  readPathRegistry,
  generateRouterWrapper,
  buildInstallRouterCommands,
  buildInstallUserLocalRouterCommands,
} from '@agenshield/sandbox';

/**
 * Resolve the agent username from state, falling back to AGENSHIELD_AGENT_HOME env.
 * Existing installations may have the user on the system but not in state.json.
 */
function getAgentUsername(): string | null {
  const state = loadState();
  const agentUser = state.users.find((u) => u.type === 'agent');
  if (agentUser) return agentUser.username;

  // Fallback: derive from AGENSHIELD_AGENT_HOME env var
  const agentHome = process.env['AGENSHIELD_AGENT_HOME'];
  if (agentHome) {
    const parts = agentHome.split('/');
    const name = parts[parts.length - 1] || null;
    if (name) {
      console.warn(`[config] agent user not in state — derived "${name}" from AGENSHIELD_AGENT_HOME. Re-run setup to fix.`);
    }
    return name;
  }

  return null;
}

/** Collect all known skill names from the SQLite-backed repository. */
function getKnownSkillNames(app: FastifyInstance): Set<string> {
  const repo = app.skillManager.getRepository();
  const names = new Set<string>();
  for (const s of repo.getAll()) names.add(s.slug);
  return names;
}

/**
 * Sync policy enforcement after any policy change (ACLs, wrappers, secrets, OpenClaw, instructions).
 */
async function syncPoliciesAfterChange(
  app: FastifyInstance,
  oldPolicies: PolicyConfig[],
  newPolicies: PolicyConfig[],
): Promise<void> {
  const state = loadState();
  const agentUsername = getAgentUsername();
  if (agentUsername) {
    syncFilesystemPolicyAcls(oldPolicies, newPolicies, agentUsername, app.log);
  }
  syncCommandPoliciesAndWrappers(newPolicies, state, app.log);
  syncSecrets(newPolicies, app.log).catch(() => { /* non-fatal */ });
  syncOpenClawFromPolicies(newPolicies);

  try {
    const targetCtx = resolveTargetContext();
    if (targetCtx) {
      const instructionsPath = path.join(targetCtx.agentHome, '.openclaw', 'policy-instructions.md');
      const markdown = generatePolicyMarkdown(newPolicies, getKnownSkillNames(app));
      fs.mkdirSync(path.dirname(instructionsPath), { recursive: true });
      fs.writeFileSync(instructionsPath, markdown, 'utf-8');
    }
  } catch { /* non-fatal */ }

  recompilePolicyEngine();
}

/**
 * After a managed policy mutation that may affect router target policies,
 * sync the allowHostPassthrough flag in path-registry.json and regenerate
 * wrapper scripts so existing wrappers pick up the new awk logic.
 */
async function syncRouterAfterManagedChange(app: FastifyInstance): Promise<void> {
  try {
    const storage = getStorage();
    const allPolicies = storage.for({ profileId: null }).policies.getAll();
    const hostHome = process.env['HOME'];

    const result = syncAndWriteRouterHostPassthrough(allPolicies, hostHome, app.log);
    if (!result.updated) return;

    // Regenerate and reinstall wrapper scripts so awk parser includes new fields
    const registry = readPathRegistry(hostHome);
    for (const binName of Object.keys(registry)) {
      const wrapperContent = generateRouterWrapper(binName);
      const installCmd = buildInstallRouterCommands(binName, wrapperContent);
      const userLocalCmd = buildInstallUserLocalRouterCommands(binName, wrapperContent, hostHome);

      if (app.privilegeExecutor) {
        await app.privilegeExecutor.execAsRoot(installCmd, { timeout: 15_000 });
        await app.privilegeExecutor.execAsRoot(userLocalCmd, { timeout: 15_000 });
      }
    }
  } catch (err) {
    app.log.warn(`[router-sync] Failed to sync router after managed policy change: ${(err as Error).message}`);
  }
}

/** Recompile the in-memory policy engine after a policy mutation. */
function recompilePolicyEngine(): void {
  if (hasPolicyManager()) {
    getPolicyManager().recompile();
  }
}

export async function configRoutes(app: FastifyInstance): Promise<void> {
  // Get current configuration (redacted for anonymous users)
  app.get('/config', async (request): Promise<GetConfigResponse> => {
    const profileId = request.shieldContext?.profileId;
    const config = profileId ? loadScopedConfig(profileId) : loadConfig();
    return {
      success: true,
      data: (await isAuthenticated(request)) ? config : redactConfig(config),
    };
  });

  // Update configuration
  app.put<{ Body: UpdateConfigRequest }>(
    '/config',
    async (request): Promise<UpdateConfigResponse> => {
      const profileId = request.shieldContext?.profileId;

      try {
        // Ensure preset policies cannot be deleted — re-inject any that are missing
        if (request.body.policies) {
          if (profileId) {
            // Profile-scoped: protect the profile's preset policies
            const profile = getStorage().profiles.getById(profileId);
            if (profile?.presetId) {
              const preset = getPresetById(profile.presetId);
              if (preset) {
                for (const presetPolicy of preset.policies) {
                  if (!request.body.policies.some((p) => p.id === presetPolicy.id)) {
                    request.body.policies.push(presetPolicy);
                  }
                }
              }
            }
          } else {
            // Protect AgenCo preset only when it was previously applied
            const hasAgenco = request.body.policies.some((p) => p.preset === 'agenco');
            if (hasAgenco) {
              for (const presetPolicy of AGENCO_PRESET.policies) {
                const exists = request.body.policies.some((p) => p.id === presetPolicy.id);
                if (!exists) {
                  request.body.policies.push(presetPolicy);
                }
              }
            }
          }
        }

        // Strip managed policies from client input — managed policies
        // can only be created/modified through the managed CRUD endpoints.
        if (request.body.policies) {
          request.body.policies = request.body.policies.filter(
            (p) => p.tier !== 'managed',
          );
        }

        const oldConfig = profileId
          ? loadScopedConfig(profileId)
          : loadConfig();
        const oldPolicies = oldConfig.policies;
        const updated = profileId
          ? updateScopedConfig(request.body, profileId)
          : updateConfig(request.body);

        // Sync policies to system enforcement
        if (request.body.policies) {
          await syncPoliciesAfterChange(app, oldPolicies, updated.policies);
        }

        // Restart process enforcer if interval changed
        if (updated.daemon.enforcerIntervalMs !== oldConfig.daemon.enforcerIntervalMs) {
          restartProcessEnforcer({ intervalMs: updated.daemon.enforcerIntervalMs ?? 1000 });
        }

        return {
          success: true,
          data: updated,
        };
      } catch (error) {
        return {
          success: false,
          error: {
            code: 'CONFIG_UPDATE_FAILED',
            message: error instanceof Error ? error.message : 'Unknown error',
          },
        };
      }
    }
  );

  /**
   * GET /config/policies/instructions — Generate semantic Markdown from active policies.
   * Returns text/markdown that OpenClaw can use as instructions.
   */
  app.get('/config/policies/instructions', async (_request: FastifyRequest, reply: FastifyReply) => {
    const config = loadConfig();
    const markdown = generatePolicyMarkdown(config.policies, getKnownSkillNames(app));
    return reply.type('text/markdown').send(markdown);
  });

  // Factory reset — wipe all user data and restore defaults
  app.post('/config/factory-reset', async (): Promise<{ success: boolean; error?: { message: string } }> => {
    try {
      // Revoke all policy enforcement before wiping config
      const oldConfig = loadConfig();
      const state = loadState();
      const agentUsername = getAgentUsername();
      if (agentUsername) {
        syncFilesystemPolicyAcls(oldConfig.policies, [], agentUsername, app.log);
      }
      // Clear command allowlist (empty policies = empty allowlist)
      syncCommandPoliciesAndWrappers([], state, app.log);

      // Clear synced secrets
      syncSecrets([], app.log).catch(() => { /* non-fatal */ });

      // 1. Reset config to defaults
      saveConfig(getDefaultConfig());

      // 2. Destroy vault (secrets, passcode, OAuth tokens)
      const vault = getVault();
      await vault.destroy();

      // 3. Reset state to defaults
      saveState(getDefaultState());

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: {
          message: error instanceof Error ? error.message : 'Factory reset failed',
        },
      };
    }
  });

  /**
   * POST /config/install-wrappers - Install shield-exec and proxied command wrappers
   *
   * One-time operation that writes /opt/agenshield/bin/shield-exec (requires sudo)
   * and creates symlinks for proxied commands (curl, wget, git, etc.) in the
   * agent user's bin directory.
   */
  app.post('/config/install-wrappers', async (): Promise<{
    success: boolean;
    installed?: string[];
    error?: string;
  }> => {
    try {
      const agentUsername = getAgentUsername();
      if (!agentUsername) {
        return { success: false, error: 'No agent user found in state or environment' };
      }

      const state = loadState();
      const agentUser = state.users.find((u) => u.type === 'agent');
      const agentHomeDir = agentUser?.homeDir
        || process.env['AGENSHIELD_AGENT_HOME']
        || `/Users/${agentUsername}`;

      const userConfig = createUserConfig();
      const binDir = path.join(agentHomeDir, 'bin');
      const result = await installShieldExec(userConfig, binDir);

      return {
        success: result.success,
        installed: result.installed,
        error: result.error,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to install wrappers',
      };
    }
  });

  /**
   * GET /config/policies/tiered — Get policies organized by tier.
   * In scoped context: returns { managed, global, target } for that profile.
   * In global context: returns { managed, global, target: [], targetSections }.
   */
  app.get('/config/policies/tiered', async (request): Promise<GetTieredPoliciesResponse> => {
    const profileId = request.shieldContext?.profileId;
    const storage = getStorage();

    if (profileId) {
      const tiered = storage.for({ profileId }).policies.getTiered();
      return { success: true, data: tiered };
    }

    // Global view: include target sections
    const globalRepo = storage.for({ profileId: null }).policies;
    const tiered = globalRepo.getTiered();
    tiered.targetSections = globalRepo.getAllTargetSections();
    return { success: true, data: tiered };
  });

  /**
   * POST /config/policies/managed — Create a managed (admin-enforced) policy.
   */
  app.post<{ Body: PolicyConfig }>(
    '/config/policies/managed',
    async (request): Promise<ApiResponse<PolicyConfig>> => {
      try {
        const storage = getStorage();
        const policy = storage.for({ profileId: null }).policies.createManaged(
          request.body,
          request.body.preset ?? 'admin',
        );
        if (policy.target === 'router') {
          await syncRouterAfterManagedChange(app);
        }
        recompilePolicyEngine();
        return { success: true, data: policy };
      } catch (error) {
        return {
          success: false,
          error: {
            code: 'MANAGED_POLICY_CREATE_FAILED',
            message: error instanceof Error ? error.message : 'Unknown error',
          },
        };
      }
    },
  );

  /**
   * PUT /config/policies/managed/:id — Update a managed policy.
   */
  app.put<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/config/policies/managed/:id',
    async (request): Promise<ApiResponse<PolicyConfig>> => {
      try {
        const storage = getStorage();
        const existing = storage.for({ profileId: null }).policies.getById(request.params.id);
        if (!existing || existing.tier !== 'managed') {
          return {
            success: false,
            error: { code: 'NOT_FOUND', message: 'Managed policy not found' },
          };
        }

        const updated = storage.for({ profileId: null }).policies.update(
          request.params.id,
          request.body as import('@agenshield/storage').UpdatePolicyInput,
        );
        if (!updated) {
          return {
            success: false,
            error: { code: 'UPDATE_FAILED', message: 'Failed to update managed policy' },
          };
        }
        if (existing.target === 'router' || updated.target === 'router') {
          await syncRouterAfterManagedChange(app);
        }
        recompilePolicyEngine();
        return { success: true, data: updated };
      } catch (error) {
        return {
          success: false,
          error: {
            code: 'MANAGED_POLICY_UPDATE_FAILED',
            message: error instanceof Error ? error.message : 'Unknown error',
          },
        };
      }
    },
  );

  /**
   * DELETE /config/policies/managed/:id — Delete a managed policy.
   */
  app.delete<{ Params: { id: string } }>(
    '/config/policies/managed/:id',
    async (request): Promise<ApiResponse<{ deleted: boolean }>> => {
      try {
        const storage = getStorage();
        const existing = storage.for({ profileId: null }).policies.getById(request.params.id);
        if (!existing || existing.tier !== 'managed') {
          return {
            success: false,
            error: { code: 'NOT_FOUND', message: 'Managed policy not found' },
          };
        }

        const deleted = storage.for({ profileId: null }).policies.delete(request.params.id);
        if (existing.target === 'router') {
          await syncRouterAfterManagedChange(app);
        }
        recompilePolicyEngine();
        return { success: true, data: { deleted } };
      } catch (error) {
        return {
          success: false,
          error: {
            code: 'MANAGED_POLICY_DELETE_FAILED',
            message: error instanceof Error ? error.message : 'Unknown error',
          },
        };
      }
    },
  );

  /**
   * POST /config/policies/managed/sync — Batch upsert managed policies from external source.
   * Replaces all managed policies from the given source with the provided list.
   */
  app.post<{ Body: { source: string; policies: PolicyConfig[] } }>(
    '/config/policies/managed/sync',
    async (request): Promise<ApiResponse<{ synced: number }>> => {
      try {
        const { source, policies } = request.body;
        const storage = getStorage();
        const repo = storage.for({ profileId: null }).policies;

        // Delete all existing managed policies from this source
        repo.deleteManagedBySource(source);

        // Insert new managed policies
        let synced = 0;
        let hasRouterPolicy = false;
        for (const p of policies) {
          repo.createManaged(p, source);
          synced++;
          if (p.target === 'router') hasRouterPolicy = true;
        }

        if (hasRouterPolicy) {
          await syncRouterAfterManagedChange(app);
        }
        recompilePolicyEngine();
        return { success: true, data: { synced } };
      } catch (error) {
        return {
          success: false,
          error: {
            code: 'MANAGED_POLICY_SYNC_FAILED',
            message: error instanceof Error ? error.message : 'Unknown error',
          },
        };
      }
    },
  );

  // ── Individual policy CRUD (non-managed) ────────────────────────────

  /**
   * POST /config/policies — Create a policy.
   * Scope auto-assigns tier: global (no profile) or target (profile-scoped).
   */
  app.post<{ Body: PolicyConfig }>(
    '/config/policies',
    async (request): Promise<ApiResponse<PolicyConfig>> => {
      try {
        if ((request.body as PolicyConfig).tier === 'managed') {
          return {
            success: false,
            error: { code: 'INVALID_TIER', message: 'Use /config/policies/managed for managed policies' },
          };
        }

        const profileId = request.shieldContext?.profileId ?? null;
        const storage = getStorage();
        const repo = storage.for({ profileId }).policies;

        const oldPolicies = repo.getAll();
        const created = repo.create(request.body);
        clearConfigCache();
        const newPolicies = repo.getAll();

        await syncPoliciesAfterChange(app, oldPolicies, newPolicies);
        return { success: true, data: created };
      } catch (error) {
        return {
          success: false,
          error: {
            code: 'POLICY_CREATE_FAILED',
            message: error instanceof Error ? error.message : 'Unknown error',
          },
        };
      }
    },
  );

  /**
   * PUT /config/policies/:id — Update a policy (non-managed, non-preset).
   */
  app.put<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/config/policies/:id',
    async (request): Promise<ApiResponse<PolicyConfig>> => {
      try {
        const storage = getStorage();
        const existing = storage.for({ profileId: null }).policies.getById(request.params.id);
        if (!existing) {
          return {
            success: false,
            error: { code: 'NOT_FOUND', message: 'Policy not found' },
          };
        }
        if (existing.tier === 'managed') {
          return {
            success: false,
            error: { code: 'INVALID_TIER', message: 'Use /config/policies/managed for managed policies' },
          };
        }
        if (existing.preset) {
          return {
            success: false,
            error: { code: 'PRESET_PROTECTED', message: 'Preset policies cannot be modified' },
          };
        }

        const profileId = request.shieldContext?.profileId ?? null;
        const repo = storage.for({ profileId }).policies;
        const oldPolicies = repo.getAll();

        const updated = repo.update(
          request.params.id,
          request.body as import('@agenshield/storage').UpdatePolicyInput,
        );
        if (!updated) {
          return {
            success: false,
            error: { code: 'UPDATE_FAILED', message: 'Failed to update policy' },
          };
        }

        clearConfigCache();
        const newPolicies = repo.getAll();
        await syncPoliciesAfterChange(app, oldPolicies, newPolicies);
        return { success: true, data: updated };
      } catch (error) {
        return {
          success: false,
          error: {
            code: 'POLICY_UPDATE_FAILED',
            message: error instanceof Error ? error.message : 'Unknown error',
          },
        };
      }
    },
  );

  /**
   * DELETE /config/policies/:id — Delete a policy (non-managed, non-preset).
   */
  app.delete<{ Params: { id: string } }>(
    '/config/policies/:id',
    async (request): Promise<ApiResponse<{ deleted: boolean }>> => {
      try {
        const storage = getStorage();
        const existing = storage.for({ profileId: null }).policies.getById(request.params.id);
        if (!existing) {
          return {
            success: false,
            error: { code: 'NOT_FOUND', message: 'Policy not found' },
          };
        }
        if (existing.tier === 'managed') {
          return {
            success: false,
            error: { code: 'INVALID_TIER', message: 'Use /config/policies/managed for managed policies' },
          };
        }
        if (existing.preset) {
          return {
            success: false,
            error: { code: 'PRESET_PROTECTED', message: 'Preset policies cannot be deleted' },
          };
        }

        const profileId = request.shieldContext?.profileId ?? null;
        const repo = storage.for({ profileId }).policies;
        const oldPolicies = repo.getAll();

        const deleted = repo.delete(request.params.id);
        clearConfigCache();
        const newPolicies = repo.getAll();
        await syncPoliciesAfterChange(app, oldPolicies, newPolicies);

        return { success: true, data: { deleted } };
      } catch (error) {
        return {
          success: false,
          error: {
            code: 'POLICY_DELETE_FAILED',
            message: error instanceof Error ? error.message : 'Unknown error',
          },
        };
      }
    },
  );

  /**
   * PUT /config/policies/:id/toggle — Toggle a policy's enabled state.
   */
  app.put<{ Params: { id: string }; Body: { enabled: boolean } }>(
    '/config/policies/:id/toggle',
    async (request): Promise<ApiResponse<PolicyConfig>> => {
      try {
        const storage = getStorage();
        const existing = storage.for({ profileId: null }).policies.getById(request.params.id);
        if (!existing) {
          return {
            success: false,
            error: { code: 'NOT_FOUND', message: 'Policy not found' },
          };
        }
        if (existing.tier === 'managed') {
          return {
            success: false,
            error: { code: 'INVALID_TIER', message: 'Managed policies cannot be toggled via this endpoint' },
          };
        }

        const profileId = request.shieldContext?.profileId ?? null;
        const repo = storage.for({ profileId }).policies;
        const oldPolicies = repo.getAll();

        const updated = repo.update(
          request.params.id,
          { enabled: request.body.enabled } as import('@agenshield/storage').UpdatePolicyInput,
        );
        if (!updated) {
          return {
            success: false,
            error: { code: 'UPDATE_FAILED', message: 'Failed to toggle policy' },
          };
        }

        clearConfigCache();
        const newPolicies = repo.getAll();
        await syncPoliciesAfterChange(app, oldPolicies, newPolicies);
        return { success: true, data: updated };
      } catch (error) {
        return {
          success: false,
          error: {
            code: 'POLICY_TOGGLE_FAILED',
            message: error instanceof Error ? error.message : 'Unknown error',
          },
        };
      }
    },
  );

  /**
   * GET /config/keychain/status — Get Keychain integration status.
   * Returns whether Keychain is available, enabled, and which categories are active.
   */
  app.get('/config/keychain/status', async (): Promise<ApiResponse<{
    platform: string;
    available: boolean;
    enabled: boolean;
    categories: string[];
    syncToICloud: boolean;
  }>> => {
    const config = loadConfig();
    const keychainConfig = config.keychain ?? { enabled: false, categories: [], syncToICloud: false };
    return {
      success: true,
      data: {
        platform: process.platform,
        available: process.platform === 'darwin',
        enabled: keychainConfig.enabled,
        categories: keychainConfig.categories,
        syncToICloud: keychainConfig.syncToICloud,
      },
    };
  });

  /**
   * GET /config/openclaw - Display agent's OpenClaw configuration
   * Returns all config files from $AGENT_HOME/.openclaw/
   */
  app.get('/config/openclaw', async (_request: FastifyRequest, reply: FastifyReply) => {
    const targetCtx = resolveTargetContext();
    if (!targetCtx) {
      return reply.code(503).send({ error: 'No target context configured' });
    }
    const configDir = path.join(targetCtx.agentHome, '.openclaw');
    const configFiles = readConfigDir(configDir);
    return reply.send({ configDir, files: configFiles });
  });

  /**
   * GET /config/openclaw/diff?original=/Users/<user>/.openclaw
   * Compare agent's config with the original user's
   */
  app.get(
    '/config/openclaw/diff',
    async (
      request: FastifyRequest<{ Querystring: { original?: string } }>,
      reply: FastifyReply
    ) => {
      const { original } = request.query;
      if (!original) {
        return reply.code(400).send({ error: 'original query param required' });
      }
      const targetCtx = resolveTargetContext();
      if (!targetCtx) {
        return reply.code(503).send({ error: 'No target context configured' });
      }
      const agentConfigDir = path.join(targetCtx.agentHome, '.openclaw');
      const diff = diffConfigDirs(original, agentConfigDir);
      return reply.send({ diff });
    }
  );
}

/** Directories to skip when reading config */
const SKIP_DIRS = new Set(['skills', 'node_modules', '.git', 'dist']);

/**
 * Read all JSON/text config files in a directory recursively.
 * Skips skills/, node_modules/, etc.
 */
function readConfigDir(dir: string, base?: string): Record<string, string> {
  const result: Record<string, string> = {};
  const root = base ?? dir;

  if (!fs.existsSync(dir)) {
    return result;
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return result;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const sub = readConfigDir(path.join(dir, entry.name), root);
      Object.assign(result, sub);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      // Only read text-like config files
      if (['.json', '.yaml', '.yml', '.toml', '.txt', '.md', '.conf', ''].includes(ext)) {
        const filePath = path.join(dir, entry.name);
        const relPath = path.relative(root, filePath);
        try {
          result[relPath] = fs.readFileSync(filePath, 'utf-8');
        } catch {
          // Unreadable — skip
        }
      }
    }
  }

  return result;
}

interface ConfigDiffEntry {
  file: string;
  status: 'added' | 'removed' | 'modified' | 'unchanged';
  original?: string;
  agent?: string;
}

/**
 * Diff two config directories file-by-file.
 * - added:    exists in agent but not original
 * - removed:  exists in original but not agent
 * - modified: exists in both but content differs
 * - unchanged: same content
 */
function diffConfigDirs(originalDir: string, agentDir: string): ConfigDiffEntry[] {
  const originalFiles = readConfigDir(originalDir);
  const agentFiles = readConfigDir(agentDir);
  const allKeys = new Set([...Object.keys(originalFiles), ...Object.keys(agentFiles)]);
  const entries: ConfigDiffEntry[] = [];

  for (const file of allKeys) {
    const inOriginal = file in originalFiles;
    const inAgent = file in agentFiles;

    if (inAgent && !inOriginal) {
      entries.push({ file, status: 'added', agent: agentFiles[file] });
    } else if (inOriginal && !inAgent) {
      entries.push({ file, status: 'removed', original: originalFiles[file] });
    } else if (inOriginal && inAgent) {
      if (originalFiles[file] === agentFiles[file]) {
        entries.push({ file, status: 'unchanged' });
      } else {
        entries.push({
          file,
          status: 'modified',
          original: originalFiles[file],
          agent: agentFiles[file],
        });
      }
    }
  }

  return entries.sort((a, b) => a.file.localeCompare(b.file));
}
