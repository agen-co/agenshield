/**
 * Command Catalog
 *
 * Static catalog of well-known commands with descriptions, security risk
 * levels, categories, and searchable tags. Used by binary-scanner for
 * classification and by the UI for rich autocomplete.
 */
import type { CatalogEntry } from './types/catalog';
/**
 * Catalog of ~80 well-known commands.
 */
export declare const COMMAND_CATALOG: Record<string, CatalogEntry>;
/**
 * Score and search catalog entries.
 *
 * Multi-word queries score each token independently and sum.
 * Returns results sorted by score descending, sliced to `limit`.
 */
export declare function searchCatalog(query: string, entries?: Record<string, CatalogEntry>, limit?: number): Array<{
    name: string;
    entry: CatalogEntry;
    score: number;
}>;
//# sourceMappingURL=catalog.d.ts.map