/**
 * Persistent activity log with rotation
 *
 * Appends every daemon event as JSONL to ~/.agenshield/activity.jsonl.
 * Rotation: max 100 MB file size (keep newest half), max 24 h retention.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { daemonEvents, type DaemonEvent } from '../events/emitter';
import { getConfigDir } from '../config/paths';

const ACTIVITY_FILE = 'activity.jsonl';
const MAX_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB
const MAX_AGE_MS = 24 * 60 * 60 * 1000;   // 24 hours
const PRUNE_INTERVAL = 1000;               // prune every N events

let instance: ActivityLog | null = null;

export function getActivityLog(): ActivityLog {
  if (!instance) {
    instance = new ActivityLog();
  }
  return instance;
}

export class ActivityLog {
  private filePath: string;
  private writeCount = 0;
  private unsubscribe?: () => void;

  constructor() {
    this.filePath = path.join(getConfigDir(), ACTIVITY_FILE);
  }

  /** Read historical events from the JSONL file, newest first */
  getHistory(limit = 500): DaemonEvent[] {
    if (!fs.existsSync(this.filePath)) return [];
    const content = fs.readFileSync(this.filePath, 'utf-8');
    const lines = content.split('\n').filter(Boolean);
    const events: DaemonEvent[] = [];
    for (const line of lines) {
      try {
        const evt = JSON.parse(line) as DaemonEvent;
        if (evt.type === 'heartbeat') continue;
        events.push(evt);
      } catch {
        // skip malformed lines
      }
    }
    // newest first
    events.reverse();
    return events.slice(0, limit);
  }

  start(): void {
    this.pruneOldEntries(); // clean up on startup
    this.unsubscribe = daemonEvents.subscribe((event) => {
      this.append(event);
    });
  }

  stop(): void {
    this.unsubscribe?.();
  }

  private append(event: DaemonEvent): void {
    const line = JSON.stringify(event) + '\n';
    fs.appendFileSync(this.filePath, line, 'utf-8');
    this.writeCount++;

    // Periodic maintenance
    if (this.writeCount % PRUNE_INTERVAL === 0) {
      this.rotate();
    }
  }

  private rotate(): void {
    try {
      const stat = fs.statSync(this.filePath);
      if (stat.size > MAX_SIZE_BYTES) {
        this.truncateBySize();
      }
    } catch {
      /* file may not exist yet */
    }
    this.pruneOldEntries();
  }

  /** Keep newest half of lines when file exceeds size limit */
  private truncateBySize(): void {
    const content = fs.readFileSync(this.filePath, 'utf-8');
    const lines = content.split('\n').filter(Boolean);
    const keep = lines.slice(Math.floor(lines.length / 2));
    fs.writeFileSync(this.filePath, keep.join('\n') + '\n', 'utf-8');
  }

  /** Remove entries older than 24 hours */
  private pruneOldEntries(): void {
    if (!fs.existsSync(this.filePath)) return;
    const content = fs.readFileSync(this.filePath, 'utf-8');
    const lines = content.split('\n').filter(Boolean);
    const cutoff = Date.now() - MAX_AGE_MS;
    const kept = lines.filter((line) => {
      try {
        const evt = JSON.parse(line);
        return new Date(evt.timestamp).getTime() >= cutoff;
      } catch {
        return false;
      }
    });
    if (kept.length < lines.length) {
      fs.writeFileSync(this.filePath, kept.join('\n') + '\n', 'utf-8');
    }
  }
}
