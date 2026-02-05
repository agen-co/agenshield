/**
 * Filesystem browse route
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { FastifyInstance } from 'fastify';
import type { FsBrowseResponse, FsBrowseEntry } from '@agenshield/ipc';

const MAX_ENTRIES = 200;

export async function fsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{
    Querystring: { path?: string; showHidden?: string };
  }>('/fs/browse', async (request): Promise<FsBrowseResponse> => {
    const dirPath = request.query.path || os.homedir();
    const showHidden = request.query.showHidden === 'true';

    const resolvedPath = path.resolve(dirPath);

    let dirents: fs.Dirent[];
    try {
      dirents = fs.readdirSync(resolvedPath, { withFileTypes: true });
    } catch {
      return { success: true, data: { entries: [] } };
    }

    const entries: FsBrowseEntry[] = [];
    for (const dirent of dirents) {
      if (!showHidden && dirent.name.startsWith('.')) continue;
      entries.push({
        name: dirent.name,
        path: path.join(resolvedPath, dirent.name),
        type: dirent.isDirectory() ? 'directory' : 'file',
      });
      if (entries.length >= MAX_ENTRIES) break;
    }

    // Sort: directories first, then alphabetical
    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return { success: true, data: { entries } };
  });
}
