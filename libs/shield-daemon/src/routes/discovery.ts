/**
 * Discovery routes — GET /discovery/scan
 *
 * Provides a cached system discovery scan covering binaries and skills.
 */

import type { FastifyInstance } from 'fastify';
import { scanDiscovery } from '@agenshield/sandbox';
import type { DiscoveryResult } from '@agenshield/ipc';

/** Cache TTL in ms (matches existing BIN_CACHE_TTL) */
const CACHE_TTL = 60_000;

let cache: { result: DiscoveryResult; cachedAt: number } | null = null;

export async function discoveryRoutes(app: FastifyInstance): Promise<void> {
  app.get<{
    Querystring: { refresh?: string; scanSkills?: string };
  }>('/discovery/scan', async (request) => {
    const refresh = request.query.refresh === 'true';
    const scanSkills = request.query.scanSkills !== 'false'; // default true

    const now = Date.now();
    if (!refresh && cache && now - cache.cachedAt < CACHE_TTL) {
      return { success: true, data: cache.result };
    }

    const agentHome = process.env['AGENSHIELD_AGENT_HOME'] || undefined;

    const result = scanDiscovery({
      agentHome,
      workspaceDir: agentHome ? `${agentHome}/workspace` : undefined,
      scanSkills: scanSkills && !!agentHome,
    });

    cache = { result, cachedAt: Date.now() };

    return { success: true, data: result };
  });
}
