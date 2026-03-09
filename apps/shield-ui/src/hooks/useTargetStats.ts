/**
 * Client-side hook that computes aggregated stats from SSE events
 * filtered by a specific target ID.
 *
 * Throttled to recompute at most once per 2 seconds to avoid
 * O(targets × events) cost on every event arrival.
 */

import { useMemo, useRef } from 'react';
import { useSnapshot } from 'valtio';
import { eventStore, type SSEEvent } from '../state/events';

export interface CommandStat {
  command: string;
  count: number;
}

export interface EndpointStat {
  endpoint: string;
  count: number;
}

export interface TargetStats {
  topCommands: CommandStat[];
  topEndpoints: EndpointStat[];
  totalEvents: number;
  blockedCount: number;
  warningCount: number;
  lastPid?: number;
}

const DEFAULT_STATS: TargetStats = {
  topCommands: [],
  topEndpoints: [],
  totalEvents: 0,
  blockedCount: 0,
  warningCount: 0,
};

const THROTTLE_MS = 2_000;

function isExecEvent(type: string): boolean {
  return type === 'interceptor:event' || type === 'exec:denied' || type === 'exec:monitored';
}

function isNetworkEvent(type: string): boolean {
  return type === 'api:outbound' || type === 'interceptor:event';
}

function isBlockedEvent(type: string): boolean {
  return type === 'exec:denied' || type === 'security:blocked' || type === 'policy:denied';
}

function isWarningEvent(type: string): boolean {
  return type === 'security:warning' || type === 'exec:monitored';
}

function extractCommand(event: SSEEvent): string | null {
  const data = event.data;
  if (data.operation === 'exec' || data.operation === 'spawn' || !data.operation) {
    const cmd = (data.command ?? data.cmd ?? data.executable) as string | undefined;
    return cmd ?? null;
  }
  return null;
}

function extractEndpoint(event: SSEEvent): string | null {
  const data = event.data;
  if (data.operation === 'http_request' || event.type === 'api:outbound') {
    const url = (data.url ?? data.endpoint ?? data.host) as string | undefined;
    return url ?? null;
  }
  return null;
}

function topN<T extends { count: number }>(map: Map<string, number>, limit: number, toItem: (key: string, count: number) => T): T[] {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, count]) => toItem(key, count));
}

export function useTargetStats(targetId: string): TargetStats {
  const snap = useSnapshot(eventStore);
  const eventsLength = snap.events.length;

  const cachedRef = useRef<TargetStats>(DEFAULT_STATS);
  const lastComputeRef = useRef(0);

  return useMemo(() => {
    const now = Date.now();
    if (now - lastComputeRef.current < THROTTLE_MS) return cachedRef.current;
    lastComputeRef.current = now;

    const filtered = snap.events.filter(
      (e) => e.profileId === targetId,
    ) as SSEEvent[];

    const commandCounts = new Map<string, number>();
    const endpointCounts = new Map<string, number>();
    let blockedCount = 0;
    let warningCount = 0;
    let lastPid: number | undefined;

    for (const event of filtered) {
      // Count blocked/warning
      if (isBlockedEvent(event.type)) blockedCount++;
      if (isWarningEvent(event.type)) warningCount++;

      // Extract commands from exec events
      if (isExecEvent(event.type)) {
        const cmd = extractCommand(event);
        if (cmd) {
          commandCounts.set(cmd, (commandCounts.get(cmd) ?? 0) + 1);
        }
      }

      // Extract endpoints from network events
      if (isNetworkEvent(event.type)) {
        const endpoint = extractEndpoint(event);
        if (endpoint) {
          endpointCounts.set(endpoint, (endpointCounts.get(endpoint) ?? 0) + 1);
        }
      }

      // Track last PID
      if (event.type === 'process:started' && !lastPid) {
        lastPid = event.data.pid as number | undefined;
      }
    }

    const result: TargetStats = {
      topCommands: topN(commandCounts, 5, (command, count) => ({ command, count })),
      topEndpoints: topN(endpointCounts, 5, (endpoint, count) => ({ endpoint, count })),
      totalEvents: filtered.length,
      blockedCount,
      warningCount,
      lastPid,
    };
    cachedRef.current = result;
    return result;
  }, [targetId, eventsLength]);
}
