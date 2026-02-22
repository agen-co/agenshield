/**
 * Log streaming route — SSE endpoint for streaming daemon logs to CLI.
 *
 * GET /logs/stream?level=info&recent=50
 *
 * Requires authentication (uses the same auth middleware as other routes).
 */

import type { FastifyInstance } from 'fastify';
import { logBuffer, type LogEntry } from '../services/log-buffer';

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
}
