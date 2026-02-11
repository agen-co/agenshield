/**
 * Activity model — Row mapper and redaction utilities
 */

import type { ActivityEvent } from '@agenshield/ipc';
import type { DbActivityEventRow } from '../../types';

// ---- Constants ----

export const REDACTED_FIELDS = ['value', 'secret', 'password', 'token', 'key'];
export const DEFAULT_MAX_EVENTS = 10_000;

// ---- Row mapper ----

export function mapEvent(row: DbActivityEventRow): ActivityEvent {
  return {
    id: row.id,
    targetId: row.target_id ?? undefined,
    type: row.type,
    timestamp: row.timestamp,
    data: JSON.parse(row.data),
    createdAt: row.created_at,
  };
}

// ---- Redaction ----

/**
 * Redact sensitive fields from event data.
 */
export function redact(data: unknown): unknown {
  if (data == null || typeof data !== 'object') return data;

  if (Array.isArray(data)) {
    return data.map((item) => redact(item));
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (REDACTED_FIELDS.some((f) => key.toLowerCase().includes(f))) {
      result[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      result[key] = redact(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}
