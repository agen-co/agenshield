/**
 * Server-Sent Events (SSE) route for real-time updates
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { daemonEvents, type DaemonEvent } from '../events/emitter';
import { isAuthenticated } from '../auth/middleware';

/**
 * Format event for SSE protocol (full data)
 */
function formatSSE(event: DaemonEvent): string {
  const eventType = event.type;
  const data = JSON.stringify(event);
  return `event: ${eventType}\ndata: ${data}\n\n`;
}

/**
 * Format stripped event for anonymous SSE (type + timestamp only, data: {})
 */
function formatStrippedSSE(event: DaemonEvent): string {
  const eventType = event.type;
  const data = JSON.stringify({ type: event.type, timestamp: event.timestamp, data: {} });
  return `event: ${eventType}\ndata: ${data}\n\n`;
}

/**
 * Register SSE routes
 */
export async function sseRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Main SSE endpoint - streams all events
   * Authenticated users get full event data; anonymous users get stripped events.
   * Token passed as query parameter: /sse/events?token=xxx
   */
  app.get('/sse/events', async (request: FastifyRequest, reply: FastifyReply) => {
    const authenticated = isAuthenticated(request);

    // Set SSE headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    });

    // Send initial connection event (heartbeats always sent in full)
    const connectEvent: DaemonEvent = {
      type: 'heartbeat',
      timestamp: new Date().toISOString(),
      data: { connected: true, message: 'SSE connection established' },
    };
    reply.raw.write(formatSSE(connectEvent));

    // Subscribe to events
    const unsubscribe = daemonEvents.subscribe((event) => {
      try {
        // Heartbeat events always sent in full; others stripped for anonymous users
        if (event.type === 'heartbeat' || authenticated) {
          reply.raw.write(formatSSE(event));
        } else {
          reply.raw.write(formatStrippedSSE(event));
        }
      } catch {
        // Client disconnected
        unsubscribe();
      }
    });

    // Send heartbeat every 30 seconds to keep connection alive
    const heartbeatInterval = setInterval(() => {
      try {
        const heartbeat: DaemonEvent = {
          type: 'heartbeat',
          timestamp: new Date().toISOString(),
          data: { ping: true },
        };
        reply.raw.write(formatSSE(heartbeat));
      } catch {
        clearInterval(heartbeatInterval);
        unsubscribe();
      }
    }, 30000);

    // Cleanup on client disconnect
    request.raw.on('close', () => {
      clearInterval(heartbeatInterval);
      unsubscribe();
    });

    // Keep the connection open (don't call reply.send())
    return reply;
  });

  /**
   * Filtered SSE endpoint - streams only specific event types
   * Usage: /sse/events/security?token=xxx or /sse/events/broker?token=xxx
   * Authenticated users get full data; anonymous users get stripped events.
   */
  app.get('/sse/events/:filter', async (request: FastifyRequest<{ Params: { filter: string } }>, reply: FastifyReply) => {
    const authenticated = isAuthenticated(request);
    const filter = request.params.filter;

    // Set SSE headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no',
    });

    // Send initial connection event
    const connectEvent: DaemonEvent = {
      type: 'heartbeat',
      timestamp: new Date().toISOString(),
      data: { connected: true, filter, message: `SSE connection established for ${filter} events` },
    };
    reply.raw.write(formatSSE(connectEvent));

    // Subscribe to filtered events
    const unsubscribe = daemonEvents.subscribe((event) => {
      // Filter events by prefix match
      if (event.type.startsWith(filter) || event.type === 'heartbeat') {
        try {
          if (event.type === 'heartbeat' || authenticated) {
            reply.raw.write(formatSSE(event));
          } else {
            reply.raw.write(formatStrippedSSE(event));
          }
        } catch {
          unsubscribe();
        }
      }
    });

    // Heartbeat
    const heartbeatInterval = setInterval(() => {
      try {
        const heartbeat: DaemonEvent = {
          type: 'heartbeat',
          timestamp: new Date().toISOString(),
          data: { ping: true },
        };
        reply.raw.write(formatSSE(heartbeat));
      } catch {
        clearInterval(heartbeatInterval);
        unsubscribe();
      }
    }, 30000);

    // Cleanup
    request.raw.on('close', () => {
      clearInterval(heartbeatInterval);
      unsubscribe();
    });

    return reply;
  });
}
