/**
 * SSE endpoint for the setup server
 *
 * Streams wizard engine state changes to the browser UI in real-time.
 * Uses a local EventEmitter (NOT the daemon's singleton).
 */

import { EventEmitter } from 'node:events';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

const HEARTBEAT_INTERVAL = 15_000; // 15 seconds

export type SetupSSEEventType =
  | 'setup:state_change'
  | 'setup:scan_complete'
  | 'setup:complete'
  | 'setup:error'
  | 'setup:log'
  | 'heartbeat';

export interface SetupSSEEvent {
  type: SetupSSEEventType;
  data: Record<string, unknown>;
}

/**
 * Local event emitter for setup SSE — not shared with the daemon
 */
export const setupEmitter = new EventEmitter();
setupEmitter.setMaxListeners(20);

/** Track active SSE connections for idle-timeout */
let activeConnections = 0;
const activeReplies: Set<import('node:http').ServerResponse> = new Set();

export function getActiveConnections(): number {
  return activeConnections;
}

/**
 * Close all active SSE connections so the server can shut down cleanly
 */
export function closeAllSSEConnections(): void {
  for (const raw of activeReplies) {
    try {
      raw.end();
    } catch {
      // Already closed
    }
  }
  activeReplies.clear();
}

/**
 * Broadcast an event to all connected SSE clients
 */
export function broadcastSetupEvent(type: SetupSSEEventType, data: Record<string, unknown>): void {
  setupEmitter.emit('event', { type, data });
}

/**
 * Register the SSE endpoint on a Fastify instance
 */
export async function registerSSE(app: FastifyInstance): Promise<void> {
  app.get('/sse/events', async (request: FastifyRequest, reply: FastifyReply) => {
    // Set SSE headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    activeConnections++;
    activeReplies.add(reply.raw);

    // Heartbeat timer
    const heartbeat = setInterval(() => {
      reply.raw.write(`event: heartbeat\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);
    }, HEARTBEAT_INTERVAL);

    // Event listener
    const onEvent = (event: SetupSSEEvent) => {
      reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
    };

    setupEmitter.on('event', onEvent);

    // Send initial connected event
    reply.raw.write(`event: heartbeat\ndata: ${JSON.stringify({ timestamp: new Date().toISOString(), connected: true })}\n\n`);

    // Cleanup on close
    request.raw.on('close', () => {
      activeConnections--;
      activeReplies.delete(reply.raw);
      clearInterval(heartbeat);
      setupEmitter.off('event', onEvent);
    });

    // Keep the connection open (don't call reply.send)
    await reply.hijack();
  });
}
