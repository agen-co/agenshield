/**
 * Policy Graph repository — Conditional policy chaining (DAG)
 *
 * Manages nodes (policy references), edges (conditional relationships),
 * and activations (runtime state).
 */

import type { PolicyNode, PolicyEdge, EdgeActivation, PolicyGraph } from '@agenshield/ipc';
import type { DbPolicyNodeRow, DbPolicyEdgeRow, DbEdgeActivationRow } from '../../types';
import { buildPolicyScopeWhere } from '../../scoping';
import { BaseRepository } from '../base.repository';
import {
  CreatePolicyNodeSchema, CreatePolicyEdgeSchema,
  UpdateNodeSchema, UpdateEdgeSchema,
  UpdateNodeCodec, UpdateEdgeCodec,
} from './policy-graph.schema';
import type {
  CreatePolicyNodeInput, CreatePolicyEdgeInput,
  UpdateNodeInput, UpdateEdgeInput,
  ActivateEdgeParams, ValidateAcyclicParams,
} from './policy-graph.schema';
import { mapNode, mapEdge, mapActivation } from './policy-graph.model';
import { Q } from './policy-graph.query';

export class PolicyGraphRepository extends BaseRepository {
  // ---- Nodes ----

  createNode(input: CreatePolicyNodeInput): PolicyNode {
    const data = this.validate(CreatePolicyNodeSchema, input);
    const id = this.generateId();
    const now = this.now();

    this.db.prepare(Q.insertNode).run({
      id,
      policyId: data.policyId,
      profileId: data.profileId ?? this.scope?.profileId ?? null,
      dormant: data.dormant ? 1 : 0,
      metadata: data.metadata != null ? JSON.stringify(data.metadata) : null,
      createdAt: now,
      updatedAt: now,
    });

    return { id, ...data, dormant: data.dormant ?? false, createdAt: now, updatedAt: now } as PolicyNode;
  }

  getNode(id: string): PolicyNode | null {
    const row = this.db.prepare(Q.selectNodeById).get(id) as DbPolicyNodeRow | undefined;
    return row ? mapNode(row) : null;
  }

  getNodeByPolicyId(policyId: string): PolicyNode | null {
    const row = this.db.prepare(Q.selectNodeByPolicyId).get(policyId) as DbPolicyNodeRow | undefined;
    return row ? mapNode(row) : null;
  }

  getNodes(): PolicyNode[] {
    const { clause, params } = buildPolicyScopeWhere(this.scope);
    const rows = this.db.prepare(Q.selectNodesByScope(clause)).all(params) as DbPolicyNodeRow[];
    return rows.map(mapNode);
  }

  updateNode(id: string, input: UpdateNodeInput): PolicyNode | null {
    const updates = this.validate(UpdateNodeSchema, input);
    if (!this.getNode(id)) return null;

    const encoded = UpdateNodeCodec.encode(updates);
    this.buildDynamicUpdate(encoded, 'policy_nodes', 'id = @id', { id });
    return this.getNode(id);
  }

  deleteNode(id: string): boolean {
    const result = this.db.prepare(Q.deleteNode).run(id);
    return result.changes > 0;
  }

  // ---- Edges ----

  createEdge(input: CreatePolicyEdgeInput): PolicyEdge {
    const data = this.validate(CreatePolicyEdgeSchema, input);
    const id = this.generateId();
    const now = this.now();

    this.db.prepare(Q.insertEdge).run({
      id,
      sourceNodeId: data.sourceNodeId,
      targetNodeId: data.targetNodeId,
      effect: data.effect,
      lifetime: data.lifetime,
      priority: data.priority ?? 0,
      condition: data.condition ?? null,
      secretName: data.secretName ?? null,
      grantPatterns: data.grantPatterns ? JSON.stringify(data.grantPatterns) : null,
      delayMs: data.delayMs ?? 0,
      enabled: data.enabled !== false ? 1 : 0,
      createdAt: now,
      updatedAt: now,
    });

    return {
      id, ...data,
      priority: data.priority ?? 0,
      delayMs: data.delayMs ?? 0,
      enabled: data.enabled !== false,
      createdAt: now,
      updatedAt: now,
    } as PolicyEdge;
  }

  getEdge(id: string): PolicyEdge | null {
    const row = this.db.prepare(Q.selectEdgeById).get(id) as DbPolicyEdgeRow | undefined;
    return row ? mapEdge(row) : null;
  }

  getEdgesFrom(sourceNodeId: string): PolicyEdge[] {
    const rows = this.db.prepare(Q.selectEdgesFromSource).all(sourceNodeId) as DbPolicyEdgeRow[];
    return rows.map(mapEdge);
  }

  getEdgesTo(targetNodeId: string): PolicyEdge[] {
    const rows = this.db.prepare(Q.selectEdgesToTarget).all(targetNodeId) as DbPolicyEdgeRow[];
    return rows.map(mapEdge);
  }

  getAllEdges(): PolicyEdge[] {
    const { clause, params } = buildPolicyScopeWhere(this.scope);
    const rows = this.db.prepare(Q.selectAllEdgesByScope(clause)).all(params) as DbPolicyEdgeRow[];
    return rows.map(mapEdge);
  }

  updateEdge(id: string, input: UpdateEdgeInput): PolicyEdge | null {
    const updates = this.validate(UpdateEdgeSchema, input);
    if (!this.getEdge(id)) return null;

    const encoded = UpdateEdgeCodec.encode(updates);
    this.buildDynamicUpdate(encoded, 'policy_edges', 'id = @id', { id });
    return this.getEdge(id);
  }

  deleteEdge(id: string): boolean {
    const result = this.db.prepare(Q.deleteEdge).run(id);
    return result.changes > 0;
  }

  /**
   * Validate that adding an edge from sourceId to targetId won't create a cycle.
   * Uses BFS from targetId to see if sourceId is reachable.
   */
  validateAcyclic(params: ValidateAcyclicParams): boolean {
    if (params.sourceId === params.targetId) return false;

    const visited = new Set<string>();
    const queue = [params.targetId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === params.sourceId) return false;
      if (visited.has(current)) continue;
      visited.add(current);

      const edges = this.db.prepare(Q.selectTargetNodeIds).all(current) as Array<{ target_node_id: string }>;
      for (const edge of edges) {
        queue.push(edge.target_node_id);
      }
    }

    return true;
  }

  // ---- Activations ----

  activate(params: ActivateEdgeParams): EdgeActivation {
    const id = this.generateId();
    const now = this.now();

    this.db.prepare(Q.insertActivation).run({
      id,
      edgeId: params.edgeId,
      activatedAt: now,
      expiresAt: params.expiresAt ?? null,
      processId: params.processId ?? null,
    });

    return {
      id,
      edgeId: params.edgeId,
      activatedAt: now,
      expiresAt: params.expiresAt,
      processId: params.processId,
      consumed: false,
    };
  }

  getActiveActivations(edgeId?: string): EdgeActivation[] {
    const now = this.now();

    if (edgeId) {
      const rows = this.db.prepare(Q.selectActiveByEdge).all({ now, edgeId }) as DbEdgeActivationRow[];
      return rows.map(mapActivation);
    }

    const rows = this.db.prepare(Q.selectActiveAll).all({ now }) as DbEdgeActivationRow[];
    return rows.map(mapActivation);
  }

  consumeActivation(id: string): void {
    this.db.prepare(Q.consumeActivation).run(id);
  }

  expireByProcess(processId: number): void {
    this.db.prepare(Q.expireByProcess).run(processId);
  }

  expireBySession(): void {
    this.db.prepare(Q.expireBySession).run();
  }

  pruneExpired(): number {
    const result = this.db.prepare(Q.pruneExpired).run();
    return result.changes;
  }

  // ---- Graph loading ----

  loadGraph(): PolicyGraph {
    const nodes = this.getNodes();
    const nodeIds = new Set(nodes.map((n) => n.id));

    // Get all edges connected to nodes in this scope
    const allEdges = this.db.prepare(Q.selectAllEdges).all() as DbPolicyEdgeRow[];
    const edges = allEdges
      .filter((e) => nodeIds.has(e.source_node_id) || nodeIds.has(e.target_node_id))
      .map(mapEdge);

    // Get active activations for these edges
    const edgeIds = new Set(edges.map((e) => e.id));
    const allActivations = this.getActiveActivations();
    const activations = allActivations.filter((a) => edgeIds.has(a.edgeId));

    return { nodes, edges, activations };
  }
}
