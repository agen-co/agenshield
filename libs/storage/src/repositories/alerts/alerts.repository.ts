/**
 * Alerts repository — Persistent alert acknowledgement system
 */

import type { Alert } from '@agenshield/ipc';
import { CreateAlertSchema } from '@agenshield/ipc';
import type { CreateAlertInput } from '@agenshield/ipc';
import type { DbAlertRow } from '../../types';
import { BaseRepository } from '../base.repository';
import type { AlertGetAllOptions, AlertCountOptions } from './alerts.schema';
import { mapAlert } from './alerts.model';
import { Q, buildSelectAll, buildCount } from './alerts.query';

export class AlertsRepository extends BaseRepository {
  /**
   * Create a new alert.
   */
  create(input: CreateAlertInput): Alert {
    const data = this.validate(CreateAlertSchema, input);
    const now = this.now();

    const result = this.db.prepare(Q.insert).run({
      activityEventId: data.activityEventId,
      profileId: data.profileId ?? null,
      eventType: data.eventType,
      severity: data.severity,
      title: data.title,
      description: data.description,
      navigationTarget: data.navigationTarget,
      details: data.details !== undefined ? JSON.stringify(data.details) : null,
      createdAt: now,
    });

    return {
      id: Number(result.lastInsertRowid),
      activityEventId: data.activityEventId,
      profileId: data.profileId,
      eventType: data.eventType,
      severity: data.severity,
      title: data.title,
      description: data.description,
      navigationTarget: data.navigationTarget,
      details: data.details,
      createdAt: now,
    };
  }

  /**
   * Get an alert by ID.
   */
  getById(id: number): Alert | null {
    const row = this.db.prepare(Q.selectById).get(id) as DbAlertRow | undefined;
    return row ? mapAlert(row) : null;
  }

  /**
   * Get alerts with pagination and filtering.
   */
  getAll(opts?: AlertGetAllOptions): Alert[] {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (!opts?.includeAcknowledged) {
      conditions.push('acknowledged_at IS NULL');
    }
    if (opts?.severity) {
      conditions.push('severity = @severity');
      params.severity = opts.severity;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = opts?.limit ?? 100;
    const offset = opts?.offset ?? 0;

    const rows = this.db.prepare(buildSelectAll(where)).all({ ...params, limit, offset }) as DbAlertRow[];
    return rows.map(mapAlert);
  }

  /**
   * Get alert count.
   */
  count(opts?: AlertCountOptions): number {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (!opts?.includeAcknowledged) {
      conditions.push('acknowledged_at IS NULL');
    }
    if (opts?.severity) {
      conditions.push('severity = @severity');
      params.severity = opts.severity;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const row = this.db.prepare(buildCount(where)).get(params) as { count: number };
    return row.count;
  }

  /**
   * Acknowledge a single alert. Returns true if acknowledged.
   */
  acknowledge(id: number): boolean {
    const result = this.db.prepare(Q.acknowledge).run({
      id,
      acknowledgedAt: this.now(),
    });
    return result.changes > 0;
  }

  /**
   * Acknowledge all unacknowledged alerts. Returns the count acknowledged.
   */
  acknowledgeAll(): number {
    const result = this.db.prepare(Q.acknowledgeAll).run({
      acknowledgedAt: this.now(),
    });
    return result.changes;
  }

  /**
   * Delete all alerts.
   */
  clear(): number {
    const result = this.db.prepare(Q.deleteAll).run();
    return result.changes;
  }
}
