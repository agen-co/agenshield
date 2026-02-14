/**
 * Activity repository — Event log with pruning and redaction
 */

import type { ActivityEvent } from '@agenshield/ipc';
import { CreateActivityEventSchema } from '@agenshield/ipc';
import type { CreateActivityEventInput } from '@agenshield/ipc';
import type { DbActivityEventRow } from '../../types';
import { BaseRepository } from '../base.repository';
import type { ActivityGetAllOptions, ActivityCountOptions } from './activity.schema';
import { mapEvent, redact, DEFAULT_MAX_EVENTS } from './activity.model';
import { Q, buildSelectAll, buildCount } from './activity.query';

export class ActivityRepository extends BaseRepository {
  /**
   * Append an activity event.
   */
  append(input: CreateActivityEventInput): ActivityEvent {
    const data = this.validate(CreateActivityEventSchema, input);
    const now = this.now();

    // Redact sensitive fields from data
    const redactedData = redact(data.data);

    const result = this.db.prepare(Q.insert).run({
      profileId: data.profileId ?? null,
      type: data.type,
      timestamp: data.timestamp,
      data: JSON.stringify(redactedData),
      createdAt: now,
    });

    return {
      id: Number(result.lastInsertRowid),
      profileId: data.profileId,
      type: data.type,
      timestamp: data.timestamp,
      data: redactedData,
      createdAt: now,
    };
  }

  /**
   * Get events with pagination.
   */
  getAll(opts?: ActivityGetAllOptions): ActivityEvent[] {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (opts?.profileId) { conditions.push('profile_id = @profileId'); params.profileId = opts.profileId; }
    if (opts?.type) { conditions.push('type = @type'); params.type = opts.type; }
    if (opts?.since) { conditions.push('timestamp >= @since'); params.since = opts.since; }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = opts?.limit ?? 100;
    const offset = opts?.offset ?? 0;

    const rows = this.db.prepare(buildSelectAll(where)).all({ ...params, limit, offset }) as DbActivityEventRow[];
    return rows.map(mapEvent);
  }

  /**
   * Get event count.
   */
  count(opts?: ActivityCountOptions): number {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (opts?.profileId) { conditions.push('profile_id = @profileId'); params.profileId = opts.profileId; }
    if (opts?.type) { conditions.push('type = @type'); params.type = opts.type; }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const row = this.db.prepare(buildCount(where)).get(params) as { count: number };
    return row.count;
  }

  /**
   * Prune old events, keeping at most `maxEvents`.
   */
  prune(maxEvents: number = DEFAULT_MAX_EVENTS): number {
    const total = this.count();
    if (total <= maxEvents) return 0;

    const toDelete = total - maxEvents;
    const result = this.db.prepare(Q.pruneOldest).run({ toDelete });
    return result.changes;
  }

  /**
   * Delete all events.
   */
  clear(): number {
    const result = this.db.prepare(Q.deleteAll).run();
    return result.changes;
  }
}
