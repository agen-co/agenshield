/**
 * Alerts schemas — Re-exports from IPC + storage-specific option types
 */

import { CreateAlertSchema } from '@agenshield/ipc';
import type { CreateAlertInput } from '@agenshield/ipc';

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

// Re-export create schema/input for convenience
export { CreateAlertSchema };
export type { CreateAlertInput };
