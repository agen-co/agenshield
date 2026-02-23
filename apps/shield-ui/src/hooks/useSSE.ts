/**
 * Hook to connect to SSE events and update the valtio event store
 */

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSnapshot } from 'valtio';
import { eventStore, addEvent, setConnected, setEvents, type SSEEvent } from '../state/events';
import { setDaemonStatus } from '../state/daemon-status';
import { createSSEClient, type SSEClient } from '../api/sse';
import { api } from '../api/client';
import { queryKeys } from '../api/hooks';
import type { DaemonStatus } from '@agenshield/ipc';
import { handleSkillSSEEvent, fetchInstalledSkills } from '../stores/skills';
import { updateShieldProgress, markShieldComplete, appendShieldLog } from '../state/setup-panel';
import { updateStore } from '../state/update';

/** Skill SSE events that change installed skills or their env var requirements */
const SKILL_ENV_EVENTS = new Set([
  'skills:installed',
  'skills:uninstalled',
  'skills:analyzed',
  'skills:integrity_restored',
]);

export function useSSE(enabled = true, token?: string | null) {
  const { connected } = useSnapshot(eventStore);
  const queryClient = useQueryClient();
  const clientRef = useRef<SSEClient | null>(null);
  const historyLoaded = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    historyLoaded.current = false;

    const client = createSSEClient(
      (type, rawData) => {
        // SSE sends full DaemonEvent { type, timestamp, data } — extract inner payload
        const data: Record<string, unknown> =
          rawData && typeof rawData === 'object' && 'data' in rawData &&
          rawData.data != null && typeof rawData.data === 'object'
            ? (rawData.data as Record<string, unknown>)
            : rawData;

        // Use daemon timestamp when available
        const hasServerTimestamp = rawData && typeof rawData === 'object' && 'timestamp' in rawData;
        const serverTs = hasServerTimestamp
            ? new Date(rawData.timestamp as string).getTime()
            : Date.now();

        if (!hasServerTimestamp) {
          console.warn('[SSE] No server timestamp for event, using Date.now()', type, rawData);
        }

        // Update daemon status store from SSE push
        if (type === 'daemon:status') {
          setDaemonStatus(data as unknown as DaemonStatus);
          return; // Don't add status events to the activity feed
        }

        // Invalidate alerts queries on alert events
        if (type === 'alerts:created' || type === 'alerts:acknowledged') {
          queryClient.invalidateQueries({ queryKey: queryKeys.alerts });
          queryClient.invalidateQueries({ queryKey: queryKeys.alertsCount });
          return; // Don't add alert meta-events to the activity feed
        }

        // Route setup events to the setup panel store
        // These high-frequency events are skipped from the activity feed to avoid
        // triggering animation subscriptions and DOM bloat during shielding.
        if (type === 'setup:shield_progress') {
          const { targetId, step, progress, message } = data as { targetId: string; step: string; progress: number; message?: string };
          updateShieldProgress(targetId, step, progress, message);
          return;
        }
        if (type === 'setup:shield_complete') {
          const { targetId, profileId } = data as { targetId: string; profileId: string };
          markShieldComplete(targetId, profileId);
          return;
        }
        if (type === 'setup:log') {
          const { targetId: logTargetId, message: logMsg, stepId: logStepId } = data as { targetId?: string; message?: string; stepId?: string };
          if (logMsg && logTargetId) {
            appendShieldLog(logTargetId, logMsg, logStepId);
          }
          return; // Don't add verbose install logs to the activity feed
        }
        if (type === 'setup:complete') {
          // Mode transition — invalidate health to pick up new mode
          queryClient.invalidateQueries({ queryKey: queryKeys.health });
        }

        // Route update events to the update store
        if (type === 'update:state') {
          if (data.state) {
            updateStore.updateState = data.state as NonNullable<typeof updateStore.updateState>;
            const steps = (data.state as { steps?: Array<{ id: string; status: string }> }).steps;
            if (steps) {
              updateStore.completedSteps = steps
                .filter((s) => s.status === 'completed')
                .map((s) => s.id);
              for (const step of steps) {
                if (step.status === 'completed' || step.status === 'error') {
                  delete updateStore.stepLogs[step.id];
                }
              }
            }
          }
        }
        if (type === 'update:log') {
          if (data.stepId && data.message) {
            updateStore.stepLogs[data.stepId as string] = data.message as string;
          }
        }
        if (type === 'update:complete') {
          updateStore.phase = 'complete';
          if (data.state) updateStore.updateState = data.state as NonNullable<typeof updateStore.updateState>;
        }
        if (type === 'update:error') {
          updateStore.phase = 'error';
          if (data.state) updateStore.updateState = data.state as NonNullable<typeof updateStore.updateState>;
        }

        // Route skill events to the skills store (don't return — let them also flow into activity feed)
        if (type.startsWith('skills:')) {
          handleSkillSSEEvent(type, data);
          // Invalidate skill env requirements when installed skills or analyses change
          if (SKILL_ENV_EVENTS.has(type)) {
            queryClient.invalidateQueries({ queryKey: queryKeys.skillEnvRequirements });
          }
        }

        // Extract source tag from the daemon event wrapper
        const source = rawData && typeof rawData === 'object' && 'source' in rawData
          ? (rawData.source as string)
          : undefined;

        const event: SSEEvent = {
          id: crypto.randomUUID(),
          type,
          data,
          timestamp: serverTs,
          source,
        };
        addEvent(event);
      },
      (isConnected) => {
        setConnected(isConnected);
        if (isConnected) {
          // Refresh skills on reconnect to catch any events missed during disconnect
          fetchInstalledSkills();

          // Load history once on first successful connection
          if (!historyLoaded.current) {
            historyLoaded.current = true;
            api.getActivity().then((res) => {
              const historical: SSEEvent[] = res.data.map((e: Record<string, unknown>) => ({
                id: crypto.randomUUID(),
                type: e.type as string,
                data: ((e.data ?? {}) as Record<string, unknown>),
                timestamp: new Date(e.timestamp as string).getTime(),
                source: e.source as string | undefined,
              }));
              setEvents(historical);
            }).catch(() => {
              // Non-fatal: history load failed, SSE events still work
            });
          }
        }
      },
      token,
    );

    clientRef.current = client;
    client.connect();

    return () => {
      client.disconnect();
      clientRef.current = null;
    };
  }, [enabled, token]);

  return { connected };
}
