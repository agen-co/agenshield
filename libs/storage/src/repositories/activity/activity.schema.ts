/**
 * Activity schemas — storage-specific option types
 */

// ---- Options types ----

export interface ActivityGetAllOptions {
  profileId?: string;
  type?: string;
  limit?: number;
  offset?: number;
  since?: string;
}

export interface ActivityCountOptions {
  profileId?: string;
  type?: string;
  since?: string;
}
