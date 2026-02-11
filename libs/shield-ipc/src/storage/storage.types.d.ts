/**
 * Storage domain types
 *
 * Shared types for the storage layer (scope filtering, metadata).
 */
export interface ScopeFilter {
    targetId?: string | null;
    userUsername?: string | null;
}
export interface MetaEntry {
    key: string;
    value: string;
}
//# sourceMappingURL=storage.types.d.ts.map