/**
 * Global metrics backfill hook — fetches persisted history from SQLite
 * and merges it into the valtio systemStore on mount.
 *
 * Runs once at app level (staleTime: Infinity) so all pages see full
 * 30-minute history immediately, regardless of which route the user visits.
 */

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useHealthGate } from '../api/hooks';
import { authFetch } from '../api/client';
import { systemStore, type MetricsSnapshot } from '../state/system-store';

const BACKFILL_LIMIT = 900; // 900 * 2s = 30 min

export function useMetricsBackfill(): void {
  const healthy = useHealthGate();

  const { data } = useQuery({
    queryKey: ['metrics-backfill'] as const,
    queryFn: async () => {
      const res = await authFetch(`/api/metrics/history?limit=${BACKFILL_LIMIT}`);
      if (!res.ok) return [];
      const json = await res.json();
      return (json.data ?? []) as MetricsSnapshot[];
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
  }, [data]);
}
