/**
 * Log routes — SSE streaming and sanitized log bundle download.
 *
 * GET /logs/stream?level=info&recent=50   — SSE stream for CLI
 * GET /logs/download?target=claude-code&maxFiles=5 — sanitized log bundle for diagnostics
 *
 * Requires authentication (uses the same auth middleware as other routes).
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { LogBundle, DaemonLogEntry, ShieldLogEntry } from '@agenshield/ipc';
import { logBuffer, type LogEntry } from '../services/log-buffer';
import { VERSION } from '../config/index';
import { sanitizeLogContent } from '../utils/log-sanitizer';

/** Pino numeric level → name */
const LEVEL_NAMES: Record<number, string> = {
  10: 'trace',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'fatal',
};

/** Name → Pino numeric level */
const LEVEL_VALUES: Record<string, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

function formatEntry(entry: LogEntry): string {
  return JSON.stringify({
    ...entry,
    levelName: LEVEL_NAMES[entry.level] ?? 'unknown',
  });
}

export async function logStreamRoutes(app: FastifyInstance): Promise<void> {
  app.get<{
    Querystring: { level?: string; recent?: string };
  }>('/logs/stream', async (request, reply) => {
    const minLevel = LEVEL_VALUES[request.query.level ?? 'info'] ?? 30;
    const recentCount = Math.min(Number(request.query.recent) || 50, 500);

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Send recent log entries first
    const recent = logBuffer.getRecent(recentCount, minLevel);
    for (const entry of recent) {
      reply.raw.write(`event: log\ndata: ${formatEntry(entry)}\n\n`);
    }

    // Stream new entries
    const unsubscribe = logBuffer.subscribe((entry) => {
      if (entry.level >= minLevel) {
        reply.raw.write(`event: log\ndata: ${formatEntry(entry)}\n\n`);
      }
    });

    // Heartbeat to keep connection alive
    const heartbeat = setInterval(() => {
      reply.raw.write(`: heartbeat\n\n`);
    }, 15_000);

    // Cleanup on close
    request.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  // ── Sanitized log bundle download ──────────────────────────────

  app.get<{
    Querystring: { target?: string; maxFiles?: string };
  }>('/logs/download', async (request, reply) => {
    const targetFilter = request.query.target;
    const maxFiles = Math.min(Math.max(Number(request.query.maxFiles) || 5, 1), 20);

    const homeDir = os.homedir();
    const hostUsername = path.basename(homeDir);
    const logsBaseDir = path.join(homeDir, '.agenshield', 'logs');

    // Collect shield operation logs
    const shieldLogs: LogBundle['shieldLogs'] = {};

    try {
      const targetDirs = fs.existsSync(logsBaseDir)
        ? fs.readdirSync(logsBaseDir, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .filter((d) => !targetFilter || d.name === targetFilter)
        : [];

      for (const dir of targetDirs) {
        const targetLogDir = path.join(logsBaseDir, dir.name);
        const logFiles = fs.readdirSync(targetLogDir)
          .filter((f) => f.startsWith('shield-') && f.endsWith('.log'))
          .sort()
          .slice(-maxFiles);

        const entries: ShieldLogEntry[] = [];
        for (const file of logFiles) {
          try {
            const raw = fs.readFileSync(path.join(targetLogDir, file), 'utf-8');
            entries.push({
              filename: file,
              content: sanitizeLogContent(raw, hostUsername),
            });
          } catch {
            // Skip unreadable files
          }
        }

        if (entries.length > 0) {
          shieldLogs[dir.name] = entries;
        }
      }
    } catch {
      // logsBaseDir may not exist yet
    }

    // Collect recent daemon logs from in-memory buffer
    const recentEntries = logBuffer.getRecent(200);
    const daemonLogs: DaemonLogEntry[] = recentEntries.map((entry) => ({
      timestamp: entry.time,
      level: LEVEL_NAMES[entry.level] ?? 'unknown',
      msg: sanitizeLogContent(entry.msg ?? '', hostUsername),
    }));

    const bundle: LogBundle = {
      version: '1.0',
      generatedAt: new Date().toISOString(),
      system: {
        os: `${os.platform()} ${os.release()}`,
        daemonVersion: VERSION,
      },
      shieldLogs,
      daemonLogs,
    };

    return reply.send({ success: true, data: bundle });
  });
}
