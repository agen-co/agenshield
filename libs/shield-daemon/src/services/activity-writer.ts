/**
 * Persistent activity writer — SQLite-backed
 *
 * Subscribes to daemon events and persists each one to the
 * SQLite activity_events table via ActivityRepository.
 * Also creates alerts for alert-worthy events.
 */

import { getStorage } from '@agenshield/storage';
import {
  isAlertWorthy,
  ALERT_RULES,
  interpolateTemplate,
  resolveNavigationTarget,
} from '@agenshield/ipc';
import { daemonEvents, type DaemonEvent } from '../events/emitter';

const PRUNE_INTERVAL = 1000;

let instance: ActivityWriter | null = null;

export function getActivityWriter(): ActivityWriter {
  if (!instance) {
    instance = new ActivityWriter();
  }
  return instance;
}

class ActivityWriter {
  private writeCount = 0;
  private unsubscribe?: () => void;

  start(): void {
    this.unsubscribe = daemonEvents.subscribe((event) => {
      if (event.type === 'heartbeat') return;
      this.append(event);
    });
  }

  stop(): void {
    this.unsubscribe?.();
  }

  private append(event: DaemonEvent): void {
    let activityEvent;
    try {
      activityEvent = getStorage().activities.append({
        type: event.type,
        timestamp: event.timestamp,
        data: event.data,
        profileId: event.profileId,
      });
    } catch {
      // Non-fatal — storage may be closing during shutdown
      return;
    }

    // Create alert for alert-worthy events
    this.maybeCreateAlert(event, activityEvent.id);

    this.writeCount++;
    if (this.writeCount % PRUNE_INTERVAL === 0) {
      try {
        getStorage().activities.prune();
      } catch {
        // Non-fatal
      }
    }
  }

  private maybeCreateAlert(event: DaemonEvent, activityEventId: number): void {
    if (!isAlertWorthy(event.type)) return;

    try {
      const rule = ALERT_RULES[event.type];
      const description = interpolateTemplate(rule.descriptionTemplate, event.data);
      const navigationTarget = resolveNavigationTarget(event.type);

      const alert = getStorage().alerts.create({
        activityEventId,
        profileId: event.profileId,
        eventType: event.type,
        severity: rule.severity,
        title: rule.title,
        description,
        navigationTarget,
        details: event.data,
      });

      // Broadcast SSE event for real-time UI update
      daemonEvents.broadcast('alerts:created' as DaemonEvent['type'], { alert }, event.profileId);
    } catch {
      // Alert creation failure must not block event processing
    }
  }
}
