/**
 * Policy Graph — Conditional policy chaining (DAG)
 *
 * Policies are nodes. Edges define conditional relationships:
 * "When policy A fires -> activate/deny/inject policy B"
 *
 * Examples:
 *   - curl to domain1 (allow) -> deny rm -rf (cascading deny)
 *   - command 'gog' (allow) -> inject secret GOG_TOKEN + open https://gogl.com + open /data/gog/**
 *   - skill X installed -> open network access to skill's declared endpoints
 */
export type EdgeEffect = 'activate' | 'deny' | 'inject_secret' | 'grant_network' | 'grant_fs' | 'revoke';
export type EdgeLifetime = 'session' | 'process' | 'once' | 'persistent';
/** A node in the policy graph — references an existing policy by ID */
export interface PolicyNode {
    id: string;
    policyId: string;
    targetId?: string;
    userUsername?: string;
    dormant: boolean;
    metadata?: unknown;
    createdAt: string;
    updatedAt: string;
}
/** A directed edge: when sourceNode fires -> apply effect on targetNode */
export interface PolicyEdge {
    id: string;
    sourceNodeId: string;
    targetNodeId: string;
    effect: EdgeEffect;
    lifetime: EdgeLifetime;
    priority: number;
    condition?: string;
    secretName?: string;
    grantPatterns?: string[];
    delayMs?: number;
    enabled: boolean;
    createdAt: string;
    updatedAt: string;
}
/** Runtime state of an activated edge (in-memory, persisted for 'persistent' lifetime) */
export interface EdgeActivation {
    id: string;
    edgeId: string;
    activatedAt: string;
    expiresAt?: string;
    processId?: number;
    consumed: boolean;
}
/** Complete policy graph for a scope (loaded into memory for fast evaluation) */
export interface PolicyGraph {
    nodes: PolicyNode[];
    edges: PolicyEdge[];
    activations: EdgeActivation[];
}
//# sourceMappingURL=policy-graph.types.d.ts.map