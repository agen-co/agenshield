/**
 * Global metrics backfill hook — fetches persisted history from SQLite
 * and merges it into the valtio systemStore on mount.
 *
 * Runs once at app level (staleTime: Infinity) so all pages see full
 * 15-minute history immediately, regardless of which route the user visits.
 */

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useHealthGate } from '../api/hooks';
import { authFetch } from '../api/client';
import { systemStore, pushEventLoopSnapshot, type MetricsSnapshot } from '../state/system-store';

const BACKFILL_LIMIT = 450; // 450 * 2s = 15 min

export function useMetricsBackfill(): void {
  const healthy = useHealthGate();

  interface BackfillSnapshot extends MetricsSnapshot {
    elMin?: number;
    elMax?: number;
    elMean?: number;
    elP50?: number;
    elP99?: number;
  }

  const { data } = useQuery({
    queryKey: ['metrics-backfill'] as const,
    queryFn: async () => {
      const res = await authFetch(`/api/metrics/history?limit=${BACKFILL_LIMIT}`);
      if (!res.ok) return [];
      const json = await res.json();
      return (json.data ?? []) as BackfillSnapshot[];
    },
    enabled: healthy,
    staleTime: Infinity, // Only fetch once per session
  });

  useEffect(() => {
    if (!data || data.length === 0) return;
    // Only backfill when the store is empty or has fewer items than what we fetched
    if (systemStore.metricsHistory.length >= data.length) return;

    const existing = new Set(systemStore.metricsHistory.map((s) => s.timestamp));
    const newSnapshots = data.filter((s) => !existing.has(s.timestamp));
    if (newSnapshots.length > 0) {
      systemStore.metricsHistory.unshift(...newSnapshots);
    }

    // Backfill event loop history from persisted snapshots
    if (systemStore.eventLoopHistory.length === 0) {
      const elSnapshots = data.filter((s) => s.elMin != null);
      for (const s of elSnapshots) {
        pushEventLoopSnapshot({
          timestamp: s.timestamp,
          min: s.elMin!,
          max: s.elMax!,
          mean: s.elMean!,
          p50: s.elP50!,
          p99: s.elP99!,
        });
      }
    }
  }, [data]);
}
