/**
 * Commands model — DB row mapper
 */

import type { AllowedCommand } from '@agenshield/ipc';
import type { DbAllowedCommandRow } from '../../types';

// ---- Row mapper ----

export function mapCommand(row: DbAllowedCommandRow): AllowedCommand {
  return {
    name: row.name,
    paths: JSON.parse(row.paths),
    addedAt: row.added_at,
    addedBy: row.added_by,
    category: row.category ?? undefined,
  };
}
