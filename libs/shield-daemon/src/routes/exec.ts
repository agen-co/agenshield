/**
 * Exec command allowlist management routes
 */

import type { FastifyInstance } from 'fastify';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SystemBinary } from '@agenshield/ipc';

const ALLOWED_COMMANDS_PATH = '/opt/agenshield/config/allowed-commands.json';

/** Directories to scan for system binaries */
const BIN_DIRS = [
  '/usr/bin',
  '/usr/local/bin',
  '/opt/homebrew/bin',
  '/usr/sbin',
  '/usr/local/sbin',
];

/** Cache for system binaries */
let binCache: { bins: SystemBinary[]; cachedAt: number } | null = null;
const BIN_CACHE_TTL = 60_000; // 60 seconds

/** Name validation: alphanumeric, hyphens, underscores only */
const VALID_NAME = /^[a-zA-Z0-9_-]+$/;

interface AllowedCommand {
  name: string;
  paths: string[];
  addedAt: string;
  addedBy: string;
  category?: string;
}

interface AllowedCommandsConfig {
  version: string;
  commands: AllowedCommand[];
}

function loadConfig(): AllowedCommandsConfig {
  if (!fs.existsSync(ALLOWED_COMMANDS_PATH)) {
    return { version: '1.0.0', commands: [] };
  }
  try {
    const content = fs.readFileSync(ALLOWED_COMMANDS_PATH, 'utf-8');
    return JSON.parse(content) as AllowedCommandsConfig;
  } catch {
    return { version: '1.0.0', commands: [] };
  }
}

function saveConfig(config: AllowedCommandsConfig): void {
  const dir = path.dirname(ALLOWED_COMMANDS_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(ALLOWED_COMMANDS_PATH, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

function scanSystemBins(): SystemBinary[] {
  // Also include dirs from PATH
  const pathDirs = (process.env.PATH ?? '').split(':').filter(Boolean);
  const allDirs = [...new Set([...BIN_DIRS, ...pathDirs])];
  const seen = new Set<string>();
  const results: SystemBinary[] = [];

  for (const dir of allDirs) {
    try {
      if (!fs.existsSync(dir)) continue;
      const entries = fs.readdirSync(dir);
      for (const entry of entries) {
        if (seen.has(entry)) continue;
        const fullPath = path.join(dir, entry);
        try {
          const stat = fs.statSync(fullPath);
          // Check if executable (any execute bit set)
          if (stat.isFile() && (stat.mode & 0o111) !== 0) {
            seen.add(entry);
            results.push({ name: entry, path: fullPath });
          }
        } catch {
          // Skip entries we can't stat
        }
      }
    } catch {
      // Skip directories we can't read
    }
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

export async function execRoutes(app: FastifyInstance): Promise<void> {
  // List system binaries
  app.get('/exec/system-bins', async () => {
    const now = Date.now();
    if (binCache && now - binCache.cachedAt < BIN_CACHE_TTL) {
      return { success: true, data: { bins: binCache.bins } };
    }

    const bins = scanSystemBins();
    binCache = { bins, cachedAt: now };
    return { success: true, data: { bins } };
  });

  // List all allowed commands (dynamic only - builtin commands are in the broker)
  app.get('/exec/allowed-commands', async () => {
    const config = loadConfig();
    return {
      success: true,
      data: {
        commands: config.commands,
      },
    };
  });

  // Add a new dynamic command
  app.post<{
    Body: { name: string; paths: string[]; category?: string };
  }>('/exec/allowed-commands', async (request) => {
    const { name, paths, category } = request.body;

    if (!name || !VALID_NAME.test(name)) {
      return {
        success: false,
        error: {
          code: 'INVALID_NAME',
          message: 'Command name must be alphanumeric with hyphens/underscores only',
        },
      };
    }

    if (!paths || !Array.isArray(paths) || paths.length === 0) {
      return {
        success: false,
        error: {
          code: 'INVALID_PATHS',
          message: 'At least one absolute path is required',
        },
      };
    }

    for (const p of paths) {
      if (!path.isAbsolute(p)) {
        return {
          success: false,
          error: {
            code: 'INVALID_PATH',
            message: `Path must be absolute: ${p}`,
          },
        };
      }
    }

    const config = loadConfig();

    // Check for duplicates
    const existing = config.commands.find((c) => c.name === name);
    if (existing) {
      return {
        success: false,
        error: {
          code: 'ALREADY_EXISTS',
          message: `Command '${name}' already exists in dynamic allowlist`,
        },
      };
    }

    const newCommand: AllowedCommand = {
      name,
      paths,
      addedAt: new Date().toISOString(),
      addedBy: 'admin',
      ...(category ? { category } : {}),
    };

    config.commands.push(newCommand);
    saveConfig(config);

    return {
      success: true,
      data: newCommand,
    };
  });

  // Remove a dynamic command
  app.delete<{
    Params: { name: string };
  }>('/exec/allowed-commands/:name', async (request) => {
    const { name } = request.params;

    const config = loadConfig();
    const index = config.commands.findIndex((c) => c.name === name);

    if (index === -1) {
      return {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Command '${name}' not found in dynamic allowlist`,
        },
      };
    }

    config.commands.splice(index, 1);
    saveConfig(config);

    return {
      success: true,
      data: { removed: name },
    };
  });
}
