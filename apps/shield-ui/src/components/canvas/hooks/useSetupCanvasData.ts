/**
 * Aggregates setup-mode canvas data from the detection store.
 *
 * Maps detected targets to ApplicationCardData[] with status derived
 * from shielding progress. Computes instanceIndex/instanceCount for
 * duplicate app types and anyShielded flag.
 */

import { useEffect, useMemo } from 'react';
import { useSnapshot } from 'valtio';
import type { DetectedTarget } from '@agenshield/ipc';
import { useHealthGate, useSecurity, useSystemMetrics } from '../../../api/hooks';
import { setupPanelStore } from '../../../state/setup-panel';
import { startMetricsSimulation, systemStore, pushMetricsSnapshot } from '../../../state/system-store';
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
      pushMetricsSnapshot({
        timestamp: Date.now(),
        cpuPercent: m.cpuPercent,
        memPercent: m.memPercent,
        diskPercent: m.diskPercent,
        netUp: m.netUp,
        netDown: m.netDown,
      });
    }
  }, [metricsData]);

  const currentUser = String(securityData?.data?.currentUser ?? 'Unknown');

  const cards = useMemo((): ApplicationCardData[] => {
    const targets = panelState.detectedTargets as DetectedTarget[];
    const progress = panelState.shieldProgress;

    // Count instances per type
    const typeCounts: Record<string, number> = {};
    targets.forEach((t) => {
      typeCounts[t.type] = (typeCounts[t.type] ?? 0) + 1;
    });

    // Track index per type as we iterate
    const typeIndices: Record<string, number> = {};

    return targets.map((t, i) => {
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

  return useMemo(() => {
    const hasDetection = cards.length > 0;
    const anyShielded = cards.some((c) => c.status === 'shielded');
    const anyUnshielded = cards.some((c) => c.status !== 'shielded');
    return { currentUser, cards, hasDetection, anyShielded, anyUnshielded, daemonRunning };
  }, [cards, currentUser, daemonRunning]);
}
