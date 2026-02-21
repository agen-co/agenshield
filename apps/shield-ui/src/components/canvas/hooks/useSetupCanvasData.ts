/**
 * Aggregates setup-mode canvas data from the detection store.
 *
 * Two data sources depending on server mode:
 * - **CLI setup mode** (`serverMode === 'setup'`): Reads from `setupStore.context`
 *   (wizard engine SSE state) to derive the detected target and its shield status.
 * - **Daemon mode**: Reads from `setupPanelStore` (detection API + SSE progress).
 *
 * Maps detected targets to ApplicationCardData[] with status derived
 * from shielding progress. Computes instanceIndex/instanceCount for
 * duplicate app types and anyShielded flag.
 */

import { useEffect, useMemo } from 'react';
import { useSnapshot } from 'valtio';
import type { DetectedTarget } from '@agenshield/ipc';
import { useHealthGate, useServerMode, useSecurity, useSystemMetrics } from '../../../api/hooks';
import { setupPanelStore } from '../../../state/setup-panel';
import { setupStore, type WizardStepId } from '../../../state/setup';
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

/** Derive card status from wizard engine completed steps */
function deriveStatusFromWizard(completedSteps: WizardStepId[]): ApplicationCardData['status'] {
  if (completedSteps.includes('verify') || completedSteps.includes('complete')) {
    return 'shielded';
  }
  if (completedSteps.includes('confirm')) {
    return 'shielding';
  }
  return 'unshielded';
}

export function useSetupCanvasData(): SetupCanvasData {
  const { data: securityData } = useSecurity();
  const daemonRunning = useHealthGate();
  const serverMode = useServerMode();
  const isCliSetup = serverMode === 'setup';
  const panelState = useSnapshot(setupPanelStore);
  const wizardSnap = useSnapshot(setupStore);

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
    // --- CLI setup mode: derive target from wizard engine context ---
    if (isCliSetup) {
      const ctx = wizardSnap.context;
      if (!ctx?.presetName) return [];

      const completedSteps = wizardSnap.completedEngineSteps as WizardStepId[];
      const status = deriveStatusFromWizard(completedSteps);

      return [{
        id: (ctx.presetId as string) ?? 'setup-target',
        name: (ctx.presetName as string) ?? 'Unknown',
        type: (ctx.presetId as string) ?? 'unknown',
        version: ctx.presetVersion as string | undefined,
        binaryPath: ctx.binaryPath as string | undefined,
        status,
        icon: iconMap[(ctx.presetId as string) ?? ''] ?? 'Terminal',
        isRunning: false,
        runAsRoot: false,
        currentUser,
        instanceIndex: 0,
        instanceCount: 1,
        side: 'left' as const,
        skills: [],
        mcpServers: [],
      }];
    }

    // --- Daemon mode: derive targets from detection store ---
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
  }, [isCliSetup, wizardSnap.context, wizardSnap.completedEngineSteps, panelState.detectedTargets, panelState.shieldProgress, currentUser]);

  const dismissedCardIds = panelState.dismissedCardIds as string[];

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
