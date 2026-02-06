/**
 * Events Batch Handler
 *
 * Accepts batches of interceptor events for audit logging.
 * The interceptor's EventReporter periodically flushes events
 * to the broker via this RPC method.
 */

import type { HandlerContext, HandlerResult, AuditEntry } from '../types.js';
import type { HandlerDependencies } from './types.js';
import type { OperationType } from '@agenshield/ipc';

interface EventsBatchParams {
  events: Array<Record<string, unknown>>;
}

export async function handleEventsBatch(
  params: Record<string, unknown>,
  context: HandlerContext,
  deps: HandlerDependencies
): Promise<HandlerResult<{ received: number }>> {
  const { events } = params as unknown as EventsBatchParams;

  const eventList = events || [];

  for (const event of eventList) {
    const entry: AuditEntry = {
      id: (event.id as string) || context.requestId,
      timestamp: event.timestamp ? new Date(event.timestamp as string) : new Date(),
      operation: ((event.operation as string) || 'events_batch') as OperationType,
      channel: 'socket',
      allowed: (event.allowed as boolean) ?? true,
      target: (event.target as string) || '',
      result: event.allowed === false ? 'denied' : 'success',
      durationMs: 0,
    };
    await deps.auditLogger.log(entry);
  }

  return {
    success: true,
    data: { received: eventList.length },
  };
}
