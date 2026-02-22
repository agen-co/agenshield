/**
 * Aggregates canvas data from the detection store.
 *
 * Reads from `setupPanelStore` (detection API + SSE progress) to derive
 * detected targets and their shield status.
 *
 * Maps detected targets to ApplicationCardData[] with status derived
 * from shielding progress. Computes instanceIndex/instanceCount for
 * duplicate app types and anyShielded flag.
 */

import { useEffect, useMemo } from 'react';
import { useSnapshot } from 'valtio';
import type { DetectedTarget } from '@agenshield/ipc';
import { useHealthGate, useSecurity, useSystemMetrics, useMetricsHistory } from '../../../api/hooks';
import { setupPanelStore } from '../../../state/setup-panel';
import { startMetricsSimulation, systemStore, pushMetricsSnapshot, markMetricsLoaded, setSystemInfo } from '../../../state/system-store';
import type { ApplicationCardData, SetupCanvasData } from '../Canvas.types';

/** Map target type to a lucide icon name */
const iconMap: Record<string, string> = {
  claude: 'Terminal',
  'claude-code': 'Terminal',
  cursor: 'Monitor',
  windsurf: 'Globe',
  openclaw: 'Globe',
};

export function useSetupCanvasData(): SetupCanvasData {
  const { data: securityData } = useSecurity();
  const daemonRunning = useHealthGate();
  const panelState = useSnapshot(setupPanelStore);

  // Start simulated metrics for cmdRate/logRate on mount
  useEffect(() => {
    const stop = startMetricsSimulation();
    return stop;
  }, []);

  // Backfill metrics history from daemon (persisted snapshots)
  const { data: historyData } = useMetricsHistory();

  useEffect(() => {
    if (historyData && historyData.length > 0 && systemStore.metricsHistory.length === 0) {
      // Prepend persisted history into the valtio store (dedup by checking existing timestamps)
      const existing = new Set(systemStore.metricsHistory.map((s) => s.timestamp));
      const newSnapshots = historyData.filter((s) => !existing.has(s.timestamp));
      if (newSnapshots.length > 0) {
        systemStore.metricsHistory.unshift(...newSnapshots);
      }
    }
  }, [historyData]);

  // Bridge real metrics from daemon API into valtio store
  const { data: metricsData } = useSystemMetrics();

  useEffect(() => {
    if (metricsData?.data) {
      const m = metricsData.data;
      systemStore.metrics.cpuPercent = m.cpuPercent;
      systemStore.metrics.memPercent = m.memPercent;
      systemStore.metrics.diskPercent = m.diskPercent;
      systemStore.metrics.netUp = m.netUp;
      systemStore.metrics.netDown = m.netDown;
      if (!systemStore.metricsLoaded) markMetricsLoaded();
      pushMetricsSnapshot({
        timestamp: Date.now(),
        cpuPercent: m.cpuPercent,
        memPercent: m.memPercent,
        diskPercent: m.diskPercent,
        netUp: m.netUp,
        netDown: m.netDown,
      });
      // Update system info (only when available from expanded response)
      if (m.hostname) {
        setSystemInfo({
          hostname: m.hostname,
          activeUser: m.activeUser ?? 'unknown',
          uptime: m.uptime ?? 0,
          platform: m.platform ?? 'unknown',
          arch: m.arch ?? 'unknown',
          cpuModel: m.cpuModel ?? 'unknown',
          totalMemory: m.totalMemory ?? 0,
          nodeVersion: m.nodeVersion ?? 'unknown',
        });
      }
    }
  }, [metricsData]);

  // Auto-detect targets on mount when daemon is healthy
  useEffect(() => {
    if (!daemonRunning) return;
    if (setupPanelStore.detectedTargets.length > 0 || setupPanelStore.isDetecting) return;

    setupPanelStore.isDetecting = true;
    fetch('/api/targets/lifecycle/detect', { method: 'POST' })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setupPanelStore.detectedTargets = data.data;
        }
      })
      .catch(() => {
        // Detection failed — non-fatal
      })
      .finally(() => {
        setupPanelStore.isDetecting = false;
      });
  }, [daemonRunning]);

  const currentUser = String(securityData?.data?.currentUser ?? 'Unknown');

  const cards = useMemo((): ApplicationCardData[] => {
    const targets = panelState.detectedTargets as DetectedTarget[];
    const progress = panelState.shieldProgress;

    // Only include targets that are actually present on the system (detected) or shielded.
    // Targets with method === 'manual' that aren't shielded are not installed — skip them.
    const visibleTargets = targets.filter((t) => t.shielded || t.method !== 'manual');

    // Count instances per type
    const typeCounts: Record<string, number> = {};
    visibleTargets.forEach((t) => {
      typeCounts[t.type] = (typeCounts[t.type] ?? 0) + 1;
    });

    // Track index per type as we iterate
    const typeIndices: Record<string, number> = {};

    return visibleTargets.map((t, i) => {
      const p = progress[t.id];
      let status: ApplicationCardData['status'] = 'unshielded';
      if (t.shielded || p?.status === 'completed') {
        status = 'shielded';
      } else if (p?.status === 'in_progress') {
        status = 'shielding';
      }

      const typeIdx = typeIndices[t.type] ?? 0;
      typeIndices[t.type] = typeIdx + 1;

      return {
        id: t.id,
        name: t.name,
        type: t.type,
        version: t.version,
        binaryPath: t.binaryPath,
        status,
        icon: iconMap[t.type] ?? 'Terminal',
        isRunning: t.isRunning ?? false,
        runAsRoot: t.runAsRoot ?? false,
        currentUser,
        instanceIndex: typeIdx,
        instanceCount: typeCounts[t.type],
        side: i % 2 === 0 ? 'left' as const : 'right' as const,
        skills: [],
        mcpServers: [],
      };
    });
  }, [panelState.detectedTargets, panelState.shieldProgress, currentUser]);

  const rawDismissedCardIds = panelState.dismissedCardIds as string[];

  // Only count dismissed targets that are actually installed (present in cards list)
  const dismissedCardIds = useMemo(
    () => rawDismissedCardIds.filter((id) => cards.some((c) => c.id === id)),
    [rawDismissedCardIds, cards],
  );

  return useMemo(() => {
    // Filter out dismissed cards
    const visibleCards = cards.filter((c) => !dismissedCardIds.includes(c.id));

    // Build name lookup for dismissed cards
    const dismissedNames: Record<string, string> = {};
    dismissedCardIds.forEach((id) => {
      const card = cards.find((c) => c.id === id);
      dismissedNames[id] = card?.name ?? id;
    });

    // Split: stopped+shielded go to bottom row, everything else to main row
    const mainCards = visibleCards.filter(
      (c) => c.isRunning || c.status !== 'shielded',
    );
    const stoppedShieldedCards = visibleCards.filter(
      (c) => !c.isRunning && c.status === 'shielded',
    );

    const allCards = [...mainCards, ...stoppedShieldedCards];
    const hasDetection = allCards.length > 0 || dismissedCardIds.length > 0;
    const anyShielded = allCards.some((c) => c.status === 'shielded');
    const anyUnshielded = allCards.some((c) => c.status !== 'shielded');

    return {
      currentUser,
      cards: mainCards,
      stoppedShieldedCards,
      hasDetection,
      anyShielded,
      anyUnshielded,
      daemonRunning,
      dismissedCardIds,
      dismissedNames,
    };
  }, [cards, currentUser, daemonRunning, dismissedCardIds]);
}
