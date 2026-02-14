/**
 * Policy Graph routes — CRUD for graph nodes, edges, and activations.
 *
 * All endpoints are under /policies/graph/* (registered inside the /api prefix).
 * Auth is handled by the parent /api auth hook.
 * Profile scoping comes from request.shieldContext.profileId.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ScopeFilter, CreatePolicyNodeInput, CreatePolicyEdgeInput } from '@agenshield/ipc';
import { contextToScope } from '@agenshield/ipc';
import { getStorage } from '@agenshield/storage';
import type { PolicyGraphRepository } from '@agenshield/storage';

/**
 * Get a scoped PolicyGraphRepository based on request context.
 */
function getScopedGraphRepo(request: FastifyRequest): PolicyGraphRepository {
  const scope: ScopeFilter = contextToScope(request.shieldContext);
  if (scope.profileId) {
    return getStorage().for(scope).policyGraph;
  }
  return getStorage().policyGraph;
}

export async function policyGraphRoutes(app: FastifyInstance): Promise<void> {
  // ─── Complete Graph ─────────────────────────────────────────

  app.get('/policies/graph', async (request) => {
    const repo = getScopedGraphRepo(request);
    const graph = repo.loadGraph();
    return { data: graph };
  });

  // ─── Nodes ──────────────────────────────────────────────────

  app.get('/policies/graph/nodes', async (request) => {
    const repo = getScopedGraphRepo(request);
    const nodes = repo.getNodes();
    return { data: nodes };
  });

  app.post('/policies/graph/nodes', async (request, reply) => {
    const repo = getScopedGraphRepo(request);
    const body = request.body as CreatePolicyNodeInput;
    try {
      const node = repo.createNode(body);
      reply.code(201);
      return { data: node };
    } catch (err) {
      reply.code(400);
      return { success: false, error: { message: err instanceof Error ? err.message : 'Invalid input' } };
    }
  });

  app.get<{ Params: { id: string } }>('/policies/graph/nodes/:id', async (request, reply) => {
    const repo = getScopedGraphRepo(request);
    const node = repo.getNode(request.params.id);
    if (!node) {
      reply.code(404);
      return { success: false, error: { message: 'Node not found' } };
    }
    return { data: node };
  });

  app.patch<{ Params: { id: string } }>('/policies/graph/nodes/:id', async (request, reply) => {
    const repo = getScopedGraphRepo(request);
    const body = request.body as Record<string, unknown>;
    try {
      const node = repo.updateNode(request.params.id, body);
      if (!node) {
        reply.code(404);
        return { success: false, error: { message: 'Node not found' } };
      }
      return { data: node };
    } catch (err) {
      reply.code(400);
      return { success: false, error: { message: err instanceof Error ? err.message : 'Invalid input' } };
    }
  });

  app.delete<{ Params: { id: string } }>('/policies/graph/nodes/:id', async (request, reply) => {
    const repo = getScopedGraphRepo(request);
    const deleted = repo.deleteNode(request.params.id);
    if (!deleted) {
      reply.code(404);
      return { success: false, error: { message: 'Node not found' } };
    }
    return { success: true };
  });

  // ─── Edges ──────────────────────────────────────────────────

  app.get('/policies/graph/edges', async (request) => {
    const repo = getScopedGraphRepo(request);
    const edges = repo.getAllEdges();
    return { data: edges };
  });

  app.post('/policies/graph/edges', async (request, reply) => {
    const repo = getScopedGraphRepo(request);
    const body = request.body as CreatePolicyEdgeInput;

    // Validate acyclic before creating
    const sourceNodeId = body.sourceNodeId;
    const targetNodeId = body.targetNodeId;
    if (sourceNodeId && targetNodeId) {
      const acyclic = repo.validateAcyclic({ sourceId: sourceNodeId, targetId: targetNodeId });
      if (!acyclic) {
        reply.code(400);
        return { success: false, error: { message: 'Edge would create a cycle in the policy graph' } };
      }
    }

    try {
      const edge = repo.createEdge(body);
      reply.code(201);
      return { data: edge };
    } catch (err) {
      reply.code(400);
      return { success: false, error: { message: err instanceof Error ? err.message : 'Invalid input' } };
    }
  });

  app.get<{ Params: { id: string } }>('/policies/graph/edges/:id', async (request, reply) => {
    const repo = getScopedGraphRepo(request);
    const edge = repo.getEdge(request.params.id);
    if (!edge) {
      reply.code(404);
      return { success: false, error: { message: 'Edge not found' } };
    }
    return { data: edge };
  });

  app.patch<{ Params: { id: string } }>('/policies/graph/edges/:id', async (request, reply) => {
    const repo = getScopedGraphRepo(request);
    const body = request.body as Record<string, unknown>;
    try {
      const edge = repo.updateEdge(request.params.id, body);
      if (!edge) {
        reply.code(404);
        return { success: false, error: { message: 'Edge not found' } };
      }
      return { data: edge };
    } catch (err) {
      reply.code(400);
      return { success: false, error: { message: err instanceof Error ? err.message : 'Invalid input' } };
    }
  });

  app.delete<{ Params: { id: string } }>('/policies/graph/edges/:id', async (request, reply) => {
    const repo = getScopedGraphRepo(request);
    const deleted = repo.deleteEdge(request.params.id);
    if (!deleted) {
      reply.code(404);
      return { success: false, error: { message: 'Edge not found' } };
    }
    return { success: true };
  });

  // ─── Activations ────────────────────────────────────────────

  app.get('/policies/graph/activations', async (request) => {
    const repo = getScopedGraphRepo(request);
    const query = request.query as Record<string, string>;
    const edgeId = query['edgeId'];
    const activations = repo.getActiveActivations(edgeId || undefined);
    return { data: activations };
  });

  app.delete<{ Params: { id: string } }>('/policies/graph/activations/:id', async (request) => {
    const repo = getScopedGraphRepo(request);
    repo.consumeActivation(request.params.id);
    return { success: true };
  });
}
