/**
 * Audit Logger
 *
 * Logs all broker operations for security auditing.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AuditEntry } from '../types.js';

export interface AuditLoggerOptions {
  logPath: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  maxFileSize?: number;
  maxFiles?: number;
}

export class AuditLogger {
  private logPath: string;
  private logLevel: AuditLoggerOptions['logLevel'];
  private maxFileSize: number;
  private maxFiles: number;
  private writeStream: fs.WriteStream | null = null;
  private currentSize: number = 0;

  private readonly levelPriority: Record<string, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  constructor(options: AuditLoggerOptions) {
    this.logPath = options.logPath;
    this.logLevel = options.logLevel;
    this.maxFileSize = options.maxFileSize || 10 * 1024 * 1024; // 10MB
    this.maxFiles = options.maxFiles || 5;

    this.initializeStream();
  }

  /**
   * Initialize the write stream
   */
  private initializeStream(): void {
    const dir = path.dirname(this.logPath);

    // Ensure directory exists
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Get current file size if file exists
    if (fs.existsSync(this.logPath)) {
      const stats = fs.statSync(this.logPath);
      this.currentSize = stats.size;
    }

    // Open write stream in append mode
    this.writeStream = fs.createWriteStream(this.logPath, {
      flags: 'a',
      encoding: 'utf-8',
    });
  }

  /**
   * Rotate log files if needed
   */
  private async maybeRotate(): Promise<void> {
    if (this.currentSize < this.maxFileSize) {
      return;
    }

    // Close current stream
    if (this.writeStream) {
      this.writeStream.end();
      this.writeStream = null;
    }

    // Rotate existing files
    for (let i = this.maxFiles - 1; i >= 1; i--) {
      const oldPath = `${this.logPath}.${i}`;
      const newPath = `${this.logPath}.${i + 1}`;

      if (fs.existsSync(oldPath)) {
        if (i === this.maxFiles - 1) {
          fs.unlinkSync(oldPath);
        } else {
          fs.renameSync(oldPath, newPath);
        }
      }
    }

    // Rotate current file
    if (fs.existsSync(this.logPath)) {
      fs.renameSync(this.logPath, `${this.logPath}.1`);
    }

    // Reset size and reopen stream
    this.currentSize = 0;
    this.initializeStream();
  }

  /**
   * Log an audit entry
   */
  async log(entry: AuditEntry): Promise<void> {
    await this.maybeRotate();

    const logLine = JSON.stringify({
      ...entry,
      timestamp: entry.timestamp.toISOString(),
    }) + '\n';

    if (this.writeStream) {
      this.writeStream.write(logLine);
      this.currentSize += Buffer.byteLength(logLine);
    }

    // Also log to console based on level
    const level = entry.allowed ? 'info' : 'warn';
    if (this.shouldLog(level)) {
      const prefix = entry.allowed ? '✓' : '✗';
      const message = `[${entry.operation}] ${prefix} ${entry.target}`;

      if (level === 'info') {
        console.info(message);
      } else {
        console.warn(message);
      }
    }
  }

  /**
   * Check if we should log at the given level
   */
  private shouldLog(level: string): boolean {
    return this.levelPriority[level] >= this.levelPriority[this.logLevel];
  }

  /**
   * Log a debug message
   */
  debug(message: string, data?: Record<string, unknown>): void {
    if (this.shouldLog('debug')) {
      console.debug(`[DEBUG] ${message}`, data || '');
    }
  }

  /**
   * Log an info message
   */
  info(message: string, data?: Record<string, unknown>): void {
    if (this.shouldLog('info')) {
      console.info(`[INFO] ${message}`, data || '');
    }
  }

  /**
   * Log a warning message
   */
  warn(message: string, data?: Record<string, unknown>): void {
    if (this.shouldLog('warn')) {
      console.warn(`[WARN] ${message}`, data || '');
    }
  }

  /**
   * Log an error message
   */
  error(message: string, data?: Record<string, unknown>): void {
    if (this.shouldLog('error')) {
      console.error(`[ERROR] ${message}`, data || '');
    }
  }

  /**
   * Query audit logs
   */
  async query(options: {
    startTime?: Date;
    endTime?: Date;
    operation?: string;
    allowed?: boolean;
    limit?: number;
  }): Promise<AuditEntry[]> {
    const results: AuditEntry[] = [];
    const limit = options.limit || 1000;

    // Read log file
    if (!fs.existsSync(this.logPath)) {
      return results;
    }

    const content = fs.readFileSync(this.logPath, 'utf-8');
    const lines = content.trim().split('\n');

    for (const line of lines.reverse()) {
      if (results.length >= limit) break;

      try {
        const parsed = JSON.parse(line) as { timestamp: string } & Omit<AuditEntry, 'timestamp'>;
        const entry: AuditEntry = {
          ...parsed,
          timestamp: new Date(parsed.timestamp),
        };

        // Apply filters
        if (options.startTime && entry.timestamp < options.startTime) continue;
        if (options.endTime && entry.timestamp > options.endTime) continue;
        if (options.operation && entry.operation !== options.operation) continue;
        if (options.allowed !== undefined && entry.allowed !== options.allowed) continue;

        results.push(entry);
      } catch {
        // Skip malformed lines
      }
    }

    return results;
  }

  /**
   * Close the logger
   */
  async close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.writeStream) {
        this.writeStream.end(() => {
          this.writeStream = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}
