/**
 * In-memory ring buffer for daemon log entries.
 *
 * Pino writes to both stdout and this buffer so the CLI `logs` command
 * can stream recent log entries via SSE without needing file access.
 */

import { Writable } from 'node:stream';

export interface LogEntry {
  level: number;
  time: number;
  msg: string;
  [key: string]: unknown;
}

type LogSubscriber = (entry: LogEntry) => void;

const MAX_ENTRIES = 1000;

class LogBuffer {
  private entries: LogEntry[] = [];
  private subscribers = new Set<LogSubscriber>();

  /** Push a log entry into the ring buffer and notify subscribers. */
  push(entry: LogEntry): void {
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_ENTRIES);
    }
    for (const sub of this.subscribers) {
      try { sub(entry); } catch { /* subscriber error — non-fatal */ }
    }
  }

  /** Get recent entries, optionally filtered by minimum level. */
  getRecent(count = 50, minLevel = 0): LogEntry[] {
    const filtered = minLevel > 0
      ? this.entries.filter((e) => e.level >= minLevel)
      : this.entries;
    return filtered.slice(-count);
  }

  /** Subscribe to new log entries. Returns an unsubscribe function. */
  subscribe(fn: LogSubscriber): () => void {
    this.subscribers.add(fn);
    return () => { this.subscribers.delete(fn); };
  }
}

/** Singleton log buffer */
export const logBuffer = new LogBuffer();

/**
 * Pino destination that writes parsed log objects into the ring buffer.
 * Use with `pino.multistream` to tee output to both stdout and the buffer.
 */
export function createLogBufferDestination() {
  return new Writable({
    write(chunk: Buffer, _encoding: string, callback: () => void) {
      try {
        const line = chunk.toString().trim();
        if (line) {
          const entry = JSON.parse(line) as LogEntry;
          logBuffer.push(entry);
        }
      } catch {
        // Not valid JSON — skip (e.g. pino-pretty output in dev)
      }
      callback();
    },
  });
}
