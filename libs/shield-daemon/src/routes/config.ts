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
import { loadConfig, updateConfig, saveConfig, getDefaultConfig } from '../config/index';
import { getDefaultState, loadState, saveState } from '../state/index';
import { getVault } from '../vault';
import { getSessionManager } from '../auth/session';
import { syncFilesystemPolicyAcls } from '../acl';
import { syncCommandPoliciesAndWrappers } from '../command-sync';
import { installShieldExec, createUserConfig } from '@agenshield/sandbox';

export async function configRoutes(app: FastifyInstance): Promise<void> {
  // Get current configuration
  app.get('/config', async (): Promise<GetConfigResponse> => {
    const config = loadConfig();
    return {
      success: true,
      data: config,
    };
  });

  // Update configuration
  app.put<{ Body: UpdateConfigRequest }>(
    '/config',
    async (request): Promise<UpdateConfigResponse> => {
      try {
        const oldPolicies = loadConfig().policies;
        const updated = updateConfig(request.body);

        // Sync policies to system enforcement
        if (request.body.policies) {
          const state = loadState();

          // Filesystem ACLs
          const wsGroup = state.groups.find((g) => g.type === 'workspace');
          if (wsGroup) {
            syncFilesystemPolicyAcls(oldPolicies, updated.policies, wsGroup.name, app.log);
          }

          // Command allowlist + wrappers
          syncCommandPoliciesAndWrappers(updated.policies, state, app.log);
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

  // Factory reset — wipe all user data and restore defaults
  app.post('/config/factory-reset', async (): Promise<{ success: boolean; error?: { message: string } }> => {
    try {
      // Revoke all policy enforcement before wiping config
      const oldConfig = loadConfig();
      const state = loadState();
      const wsGroup = state.groups.find((g) => g.type === 'workspace');
      if (wsGroup) {
        syncFilesystemPolicyAcls(oldConfig.policies, [], wsGroup.name, app.log);
      }
      // Clear command allowlist (empty policies = empty allowlist)
      syncCommandPoliciesAndWrappers([], state, app.log);

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
      const state = loadState();
      const agentUser = state.users.find((u) => u.type === 'agent');
      if (!agentUser) {
        return { success: false, error: 'No agent user found in state' };
      }

      const userConfig = createUserConfig();
      const binDir = path.join(agentUser.homeDir, 'bin');
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
