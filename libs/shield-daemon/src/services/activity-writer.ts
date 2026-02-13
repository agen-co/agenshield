/**
 * Persistent activity writer — SQLite-backed
 *
 * Subscribes to daemon events and persists each one to the
 * SQLite activity_events table via ActivityRepository.
 * Replaces the old JSONL-based ActivityLog.
 */

import { getStorage } from '@agenshield/storage';
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
    try {
      getStorage().activities.append({
        type: event.type,
        timestamp: event.timestamp,
        data: event.data,
      });
    } catch {
      // Non-fatal — storage may be closing during shutdown
      return;
    }

    this.writeCount++;
    if (this.writeCount % PRUNE_INTERVAL === 0) {
      try {
        getStorage().activities.prune();
      } catch {
        // Non-fatal
      }
    }
  }
}
