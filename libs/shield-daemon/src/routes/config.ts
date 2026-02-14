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
} from '@agenshield/ipc';
import { OPENCLAW_PRESET, AGENCO_PRESET, getPresetById } from '@agenshield/ipc';
import { loadConfig, loadScopedConfig, updateConfig, updateScopedConfig, saveConfig, getDefaultConfig } from '../config/index';
import { getStorage } from '@agenshield/storage';
import { getDefaultState, loadState, saveState } from '../state/index';
import { getVault } from '../vault';
import { getSessionManager } from '../auth/session';
import { isAuthenticated } from '../auth/middleware';
import { redactConfig } from '../auth/redact';
import { syncFilesystemPolicyAcls } from '../acl';
import { syncCommandPoliciesAndWrappers } from '../command-sync';
import { syncSecrets } from '../secret-sync';
import { syncOpenClawFromPolicies } from '../services/openclaw-config';
import { installShieldExec, createUserConfig } from '@agenshield/sandbox';
import { generatePolicyMarkdown } from '../services/policy-markdown';

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

export async function configRoutes(app: FastifyInstance): Promise<void> {
  // Get current configuration (redacted for anonymous users)
  app.get('/config', async (request): Promise<GetConfigResponse> => {
    const profileId = request.shieldContext?.profileId;
    const config = profileId ? loadScopedConfig(profileId) : loadConfig();
    return {
      success: true,
      data: isAuthenticated(request) ? config : redactConfig(config),
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
            // Global: protect OpenClaw preset
            for (const presetPolicy of OPENCLAW_PRESET.policies) {
              const exists = request.body.policies.some((p) => p.id === presetPolicy.id);
              if (!exists) {
                request.body.policies.push(presetPolicy);
              }
            }

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

        const oldPolicies = profileId
          ? loadScopedConfig(profileId).policies
          : loadConfig().policies;
        const updated = profileId
          ? updateScopedConfig(request.body, profileId)
          : updateConfig(request.body);

        // Sync policies to system enforcement
        if (request.body.policies) {
          const state = loadState();

          // Filesystem ACLs
          const agentUsername = getAgentUsername();
          if (agentUsername) {
            syncFilesystemPolicyAcls(oldPolicies, updated.policies, agentUsername, app.log);
          } else {
            app.log.warn('[config] No agent user found in state or environment — filesystem ACL sync skipped');
          }

          // Command allowlist + wrappers
          syncCommandPoliciesAndWrappers(updated.policies, state, app.log);

          // Sync secrets to broker (policy bindings may have changed)
          syncSecrets(updated.policies, app.log).catch(() => { /* non-fatal */ });

          // Sync openclaw.json (allowBundled, load.watch, strip env/install)
          syncOpenClawFromPolicies(updated.policies);
        }

        // Auto-generate policy instructions Markdown for OpenClaw
        try {
          const agentHome = process.env['AGENSHIELD_AGENT_HOME'] || '/Users/ash_default_agent';
          const instructionsPath = path.join(agentHome, '.openclaw', 'policy-instructions.md');
          const markdown = generatePolicyMarkdown(updated.policies, getKnownSkillNames(app));
          fs.mkdirSync(path.dirname(instructionsPath), { recursive: true });
          fs.writeFileSync(instructionsPath, markdown, 'utf-8');
          app.log.info(`[config] wrote policy instructions to ${instructionsPath}`);
        } catch {
          // Non-fatal: instructions file write failed (dev mode, permissions, etc.)
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

      // 4. Clear all active sessions
      getSessionManager().clearAllSessions();

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
   * GET /config/openclaw - Display agent's OpenClaw configuration
   * Returns all config files from $AGENT_HOME/.openclaw/
   */
  app.get('/config/openclaw', async (_request: FastifyRequest, reply: FastifyReply) => {
    const agentHome = process.env['AGENSHIELD_AGENT_HOME'] || '/Users/ash_default_agent';
    const configDir = path.join(agentHome, '.openclaw');
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
      const agentHome = process.env['AGENSHIELD_AGENT_HOME'] || '/Users/ash_default_agent';
      const agentConfigDir = path.join(agentHome, '.openclaw');
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
