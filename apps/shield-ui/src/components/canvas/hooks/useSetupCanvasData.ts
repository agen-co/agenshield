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
import { useHealthGate, useProfiles, useSecurity, useSystemMetrics } from '../../../api/hooks';
import { setupPanelStore, mergeDetectedTargets, loadDismissedTargets } from '../../../state/setup-panel';
import { startMetricsSimulation, systemStore } from '../../../state/system-store';
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
  const { data: profilesData } = useProfiles();
  const daemonRunning = useHealthGate();
  const panelState = useSnapshot(setupPanelStore);

  // Start simulated metrics for cmdRate/logRate on mount
  useEffect(() => {
    const stop = startMetricsSimulation();
    return stop;
  }, []);

  // Seed initial metrics from REST (SSE push takes over after first event)
  useSystemMetrics();

  // Auto-detect targets on mount when daemon is healthy
  useEffect(() => {
    if (!daemonRunning) return;
    if (setupPanelStore.detectedTargets.length > 0 || setupPanelStore.isDetecting) return;

    setupPanelStore.isDetecting = true;

    // Load dismissed targets + detect in parallel
    Promise.all([
      loadDismissedTargets(),
      fetch('/api/targets/lifecycle/detect', { method: 'POST' })
        .then((res) => res.json())
        .then((data) => {
          if (data.success) {
            mergeDetectedTargets(data.data);
          }
        }),
    ])
      .catch(() => {
        // Detection failed — non-fatal
      })
      .finally(() => {
        setupPanelStore.isDetecting = false;
      });
  }, [daemonRunning]);

  const currentUser = String(securityData?.data?.currentUser ?? 'Unknown');

  // Build a lookup map from targetName/profileId to agentUsername
  const profileUsernames = useMemo(() => {
    const map = new Map<string, string>();
    const profiles = profilesData?.data;
    if (profiles && Array.isArray(profiles)) {
      for (const p of profiles) {
        const username = (p as Record<string, unknown>).agentUsername as string | undefined;
        if (username) {
          map.set(p.id, username);
          if ((p as Record<string, unknown>).targetName) {
            map.set((p as Record<string, unknown>).targetName as string, username);
          }
        }
      }
    }
    return map;
  }, [profilesData]);

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
        agentUsername: profileUsernames.get(t.id) ?? profileUsernames.get(p?.profileId ?? ''),
      };
    });
  }, [panelState.detectedTargets, panelState.shieldProgress, currentUser, profileUsernames]);

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
