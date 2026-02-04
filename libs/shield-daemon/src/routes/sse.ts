/**
 * Server-Sent Events (SSE) route for real-time updates
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { daemonEvents, type DaemonEvent } from '../events/emitter';
import { isAuthenticated } from '../auth/middleware';

/**
 * Format event for SSE protocol
 */
function formatSSE(event: DaemonEvent): string {
  const eventType = event.type;
  const data = JSON.stringify(event);
  return `event: ${eventType}\ndata: ${data}\n\n`;
}

/**
 * Register SSE routes
 */
export async function sseRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Main SSE endpoint - streams all events
   * Requires authentication via query parameter: /sse/events?token=xxx
   */
  app.get('/sse/events', async (request: FastifyRequest, reply: FastifyReply) => {
    // Check authentication (token passed as query parameter)
    if (!isAuthenticated(request)) {
      reply.code(401).send({
        success: false,
        error: 'Authentication required. Provide token as query parameter: ?token=xxx',
        code: 'UNAUTHORIZED',
      });
      return;
    }
    // Set SSE headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    });

    // Send initial connection event
    const connectEvent: DaemonEvent = {
      type: 'heartbeat',
      timestamp: new Date().toISOString(),
      data: { connected: true, message: 'SSE connection established' },
    };
    reply.raw.write(formatSSE(connectEvent));

    // Subscribe to events
    const unsubscribe = daemonEvents.subscribe((event) => {
      try {
        reply.raw.write(formatSSE(event));
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
   * Requires authentication via query parameter
   */
  app.get('/sse/events/:filter', async (request: FastifyRequest<{ Params: { filter: string } }>, reply: FastifyReply) => {
    // Check authentication (token passed as query parameter)
    if (!isAuthenticated(request)) {
      reply.code(401).send({
        success: false,
        error: 'Authentication required. Provide token as query parameter: ?token=xxx',
        code: 'UNAUTHORIZED',
      });
      return;
    }

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
          reply.raw.write(formatSSE(event));
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
