/**
 * Alerts schemas — storage-specific option types
 */

// ---- Options types ----

export interface AlertGetAllOptions {
  limit?: number;
  offset?: number;
  includeAcknowledged?: boolean;
  severity?: string;
}

export interface AlertCountOptions {
  includeAcknowledged?: boolean;
  severity?: string;
}
