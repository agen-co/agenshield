/**
 * MCP server management routes
 *
 * Endpoints for listing, registering, updating, and managing MCP servers.
 */

import type { FastifyInstance } from 'fastify';
import type { CreateMcpServerInput, UpdateMcpServerInput } from '@agenshield/ipc';
import { getStorage } from '@agenshield/storage';
import { getMcpManager, hasMcpManager } from '../services/mcp-manager';
import { getCapabilityProber } from '../services/mcp-capability-prober';

export async function mcpsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /mcps — List all MCP servers.
   * Supports ?profileId=, ?source=, ?status= query filters.
   */
  app.get('/mcps', async (request) => {
    const query = request.query as { profileId?: string; source?: string; status?: string };

    if (!hasMcpManager()) {
      const storage = getStorage();
      return { success: true, data: storage.mcpServers.getAll() };
    }

    const manager = getMcpManager();
    const data = manager.getAll(query);
    return { success: true, data };
  });

  /**
   * GET /mcps/:id — Get MCP server detail.
   */
  app.get('/mcps/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const storage = getStorage();

    const server = storage.mcpServers.getById(id);
    if (!server) {
      return reply.status(404).send({
        success: false,
        error: { message: `MCP server not found: ${id}`, statusCode: 404 },
      });
    }

    return { success: true, data: server };
  });

  /**
   * POST /mcps — Register a new MCP server.
   */
  app.post('/mcps', async (request, reply) => {
    const input = request.body as CreateMcpServerInput;

    if (!hasMcpManager()) {
      const storage = getStorage();
      const server = storage.mcpServers.create(input);
      return reply.status(201).send({ success: true, data: server });
    }

    const manager = getMcpManager();
    const server = manager.add(input);
    return reply.status(201).send({ success: true, data: server });
  });

  /**
   * PATCH /mcps/:id — Update an MCP server.
   */
  app.patch('/mcps/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = request.body as UpdateMcpServerInput;
    const storage = getStorage();

    const updated = storage.mcpServers.update(id, input);
    if (!updated) {
      return reply.status(404).send({
        success: false,
        error: { message: `MCP server not found: ${id}`, statusCode: 404 },
      });
    }

    return { success: true, data: updated };
  });

  /**
   * DELETE /mcps/:id — Remove an MCP server.
   */
  app.delete('/mcps/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    if (!hasMcpManager()) {
      const storage = getStorage();
      const deleted = storage.mcpServers.delete(id);
      if (!deleted) {
        return reply.status(404).send({
          success: false,
          error: { message: `MCP server not found: ${id}`, statusCode: 404 },
        });
      }
      return { success: true };
    }

    const manager = getMcpManager();
    manager.remove(id);
    return { success: true };
  });

  /**
   * POST /mcps/:id/enable — Enable an MCP server and inject into target config.
   */
  app.post('/mcps/:id/enable', async (request, reply) => {
    const { id } = request.params as { id: string };

    if (!hasMcpManager()) {
      return reply.status(503).send({
        success: false,
        error: { message: 'MCP manager is initializing', statusCode: 503 },
      });
    }

    const manager = getMcpManager();
    const server = manager.enable(id);
    return { success: true, data: server };
  });

  /**
   * POST /mcps/:id/disable — Disable an MCP server and remove from target config.
   */
  app.post('/mcps/:id/disable', async (request, reply) => {
    const { id } = request.params as { id: string };

    if (!hasMcpManager()) {
      return reply.status(503).send({
        success: false,
        error: { message: 'MCP manager is initializing', statusCode: 503 },
      });
    }

    const manager = getMcpManager();
    const server = manager.disable(id);
    return { success: true, data: server };
  });

  /**
   * POST /mcps/:id/approve — Approve a quarantined MCP server.
   */
  app.post('/mcps/:id/approve', async (request, reply) => {
    const { id } = request.params as { id: string };

    if (!hasMcpManager()) {
      return reply.status(503).send({
        success: false,
        error: { message: 'MCP manager is initializing', statusCode: 503 },
      });
    }

    const manager = getMcpManager();
    const server = manager.approve(id);
    return { success: true, data: server };
  });

  /**
   * POST /mcps/scan — Force re-scan workspace configs.
   */
  app.post('/mcps/scan', async (_request, reply) => {
    if (!hasMcpManager()) {
      return reply.status(503).send({
        success: false,
        error: { message: 'MCP manager is initializing', statusCode: 503 },
      });
    }

    const manager = getMcpManager();
    manager.scanWorkspaces();
    const storage = getStorage();
    const data = storage.mcpServers.getAll();
    return { success: true, data };
  });

  /**
   * GET /mcps/:id/capabilities — Probe server tools/resources/prompts
   */
  app.get('/mcps/:id/capabilities', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { refresh } = request.query as { refresh?: string };
    const storage = getStorage();

    const server = storage.mcpServers.getById(id);
    if (!server) {
      return reply.status(404).send({
        success: false,
        error: { message: 'Not found' },
      });
    }

    if (server.status === 'disabled' || server.status === 'blocked') {
      return reply.status(400).send({
        success: false,
        error: { message: `Cannot probe: server is ${server.status}` },
      });
    }

    const prober = getCapabilityProber();
    if (refresh === 'true') prober.invalidate(id);

    const capabilities = await prober.probe(server);
    return { success: true, data: capabilities };
  });
}
