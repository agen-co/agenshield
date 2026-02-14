/**
 * Activity schemas — Re-exports from IPC + storage-specific option types
 */

import { CreateActivityEventSchema } from '@agenshield/ipc';
import type { CreateActivityEventInput } from '@agenshield/ipc';

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
}

// Re-export create schema/input for convenience
export { CreateActivityEventSchema };
export type { CreateActivityEventInput };
