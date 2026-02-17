/**
 * Execution Trace Store
 *
 * In-memory store mapping traceId to execution context.
 * Tracks parent-child execution chains across all enforcement layers.
 * Supports shared capability computation via edge sharing configs.
 */

import type { PolicyGraph, EdgeSharingConfig } from '@agenshield/ipc';

/** Deferred activation triggered by sequential constraint edges */
export interface DeferredActivation {
  edgeId: string;
  targetPolicyId: string;
}

/** An execution trace record */
export interface ExecutionTrace {
  traceId: string;
  parentTraceId?: string;
  command: string;
  policyId?: string;
  graphNodeId?: string;
  deferredActivations?: DeferredActivation[];
  profileId?: string;
  depth: number;
  execId?: string;
  status: 'running' | 'completed';
  startedAt: number;
  completedAt?: number;
}

/** Capabilities shared from parent to child via edge config */
export interface SharedCapabilities {
  networkPatterns: string[];
  fsPaths: { read: string[]; write: string[] };
  secretNames: string[];
}

export class TraceStore {
  private traces = new Map<string, ExecutionTrace>();

  /** Create a new trace record */
  create(trace: ExecutionTrace): void {
    this.traces.set(trace.traceId, trace);
  }

  /** Get a trace by ID */
  get(traceId: string): ExecutionTrace | undefined {
    return this.traces.get(traceId);
  }

  /** Mark a trace as completed */
  complete(traceId: string): void {
    const trace = this.traces.get(traceId);
    if (trace) {
      trace.status = 'completed';
      trace.completedAt = Date.now();
    }
  }

  /** Get all children of a parent trace */
  getByParent(parentTraceId: string): ExecutionTrace[] {
    const children: ExecutionTrace[] = [];
    for (const trace of this.traces.values()) {
      if (trace.parentTraceId === parentTraceId) {
        children.push(trace);
      }
    }
    return children;
  }

  /**
   * Get shared capabilities from parent to child based on graph edge config.
   *
   * Looks up the parent trace's graph node, finds the edge from parent's node
   * to the child's graph node, and reads the edge's sharing config.
   * Returns ONLY what the edge explicitly shares (default: nothing).
   */
  getSharedCapabilities(
    parentTraceId: string,
    childGraphNodeId: string,
    graph: PolicyGraph,
  ): SharedCapabilities | undefined {
    const parentTrace = this.traces.get(parentTraceId);
    if (!parentTrace?.graphNodeId) return undefined;

    // Find the edge from parent's graph node to the child's graph node
    const edge = graph.edges.find(
      e => e.sourceNodeId === parentTrace.graphNodeId &&
           e.targetNodeId === childGraphNodeId &&
           e.enabled,
    );

    if (!edge?.sharing) return undefined;

    return sharingConfigToCapabilities(edge.sharing);
  }

  /** Prune traces older than maxAgeMs */
  prune(maxAgeMs: number): void {
    const cutoff = Date.now() - maxAgeMs;
    for (const [id, trace] of this.traces) {
      if (trace.startedAt < cutoff) {
        this.traces.delete(id);
      }
    }
  }

  /** Remove trace linked to a specific proxy execId */
  removeByExecId(execId: string): void {
    for (const [id, trace] of this.traces) {
      if (trace.execId === execId) {
        this.traces.delete(id);
        return;
      }
    }
  }

  /** Number of active traces */
  get size(): number {
    return this.traces.size;
  }
}

/** Convert edge sharing config to shared capabilities */
function sharingConfigToCapabilities(sharing: EdgeSharingConfig): SharedCapabilities {
  return {
    networkPatterns: sharing.shareNetwork ?? [],
    fsPaths: {
      read: sharing.shareFs?.read ?? [],
      write: sharing.shareFs?.write ?? [],
    },
    secretNames: sharing.shareSecrets ?? [],
  };
}

// Module-level singleton
let _store: TraceStore | undefined;

export function getTraceStore(): TraceStore {
  if (!_store) {
    _store = new TraceStore();
  }
  return _store;
}

export function resetTraceStore(): void {
  _store = undefined;
}
