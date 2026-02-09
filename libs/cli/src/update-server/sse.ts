/**
 * SSE endpoint for the update server
 *
 * Streams update engine state changes to the browser UI in real-time.
 * Uses a local EventEmitter (NOT the daemon's singleton).
 */

import { EventEmitter } from 'node:events';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

const HEARTBEAT_INTERVAL = 15_000;

export type UpdateSSEEventType =
  | 'update:state'
  | 'update:log'
  | 'update:complete'
  | 'update:error'
  | 'heartbeat';

export interface UpdateSSEEvent {
  type: UpdateSSEEventType;
  data: Record<string, unknown>;
}

/**
 * Local event emitter for update SSE
 */
export const updateEmitter = new EventEmitter();
updateEmitter.setMaxListeners(20);

let activeConnections = 0;
const activeReplies: Set<import('node:http').ServerResponse> = new Set();

export function getActiveConnections(): number {
  return activeConnections;
}

export function closeAllSSEConnections(): void {
  for (const raw of activeReplies) {
    try { raw.end(); } catch { /* already closed */ }
  }
  activeReplies.clear();
}

export function broadcastUpdateEvent(type: UpdateSSEEventType, data: Record<string, unknown>): void {
  updateEmitter.emit('event', { type, data });
}

export async function registerSSE(app: FastifyInstance): Promise<void> {
  app.get('/sse/events', async (request: FastifyRequest, reply: FastifyReply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    activeConnections++;
    activeReplies.add(reply.raw);

    const heartbeat = setInterval(() => {
      reply.raw.write(`event: heartbeat\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);
    }, HEARTBEAT_INTERVAL);

    const onEvent = (event: UpdateSSEEvent) => {
      reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
    };

    updateEmitter.on('event', onEvent);

    // Send initial connected event
    reply.raw.write(`event: heartbeat\ndata: ${JSON.stringify({ timestamp: new Date().toISOString(), connected: true })}\n\n`);

    request.raw.on('close', () => {
      activeConnections--;
      activeReplies.delete(reply.raw);
      clearInterval(heartbeat);
      updateEmitter.off('event', onEvent);
    });

    await reply.hijack();
  });
}
