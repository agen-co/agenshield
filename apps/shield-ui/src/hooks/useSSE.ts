/**
 * Hook to connect to SSE events and update the valtio event store
 */

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSnapshot } from 'valtio';
import { eventStore, addEvent, setConnected, setEvents, type SSEEvent } from '../state/events';
import { setDaemonStatus } from '../state/daemon-status';
import { setSecurityStatus } from '../state/security';
import { setTargets } from '../state/targets';
import { addAlert, acknowledgeAlertInStore, acknowledgeAllAlertsInStore, alertsStore } from '../state/alerts';
import { handleMetricsSnapshot, handleEventLoopSnapshot } from '../state/system-store';
import { createSSEClient, type SSEClient } from '../api/sse';
import { api } from '../api/client';
import { scopeStore } from '../state/scope';
import { queryKeys } from '../api/hooks';
import type { DaemonStatus, SecurityStatusPayload, MetricsSnapshotPayload, EventLoopPayload, TargetStatusInfo, Alert } from '@agenshield/ipc';
import { handleSkillSSEEvent, fetchInstalledSkills } from '../stores/skills';
import { updateShieldProgress, markShieldComplete, markShieldError, appendShieldLog, updateShieldSteps, appendStepLog } from '../state/setup-panel';
import { updateStore } from '../state/update';
import { securityStore } from '../state/security';
import { targetsStore } from '../state/targets';
import { targetsApi } from '../api/targets';

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

        // Update security status store from SSE push
        if (type === 'security:status') {
          setSecurityStatus(data as unknown as SecurityStatusPayload);
          return; // Periodic status, not activity feed material
        }

        // Update metrics store from SSE push
        if (type === 'metrics:snapshot') {
          handleMetricsSnapshot(data as unknown as MetricsSnapshotPayload);
          return; // High-frequency telemetry, never in activity feed
        }

        // Update event loop metrics store from SSE push
        if (type === 'metrics:eventloop') {
          handleEventLoopSnapshot(data as unknown as EventLoopPayload);
          return; // High-frequency telemetry, never in activity feed
        }

        // Update targets store from SSE push
        if (type === 'targets:status') {
          setTargets((data as { targets: TargetStatusInfo[] }).targets);
          return;
        }

        // Update alerts store from SSE push
        if (type === 'alerts:created') {
          addAlert((data as { alert: Alert }).alert);
          return; // Don't add alert meta-events to the activity feed
        }
        if (type === 'alerts:acknowledged') {
          const { alertId } = data as { alertId: number };
          if (alertId === -1) {
            acknowledgeAllAlertsInStore();
          } else {
            acknowledgeAlertInStore(alertId);
          }
          return; // Don't add alert meta-events to the activity feed
        }

        // Route setup events to the setup panel store.
        // High-frequency / noisy events (shield_steps, step_log, log) are filtered
        // from the activity feed. Milestone events (shield_progress, shield_complete)
        // fall through to addEvent() so they appear in the feed.
        if (type === 'setup:shield_steps') {
          const { targetId, steps, overallProgress } = data as { targetId: string; steps: import('@agenshield/ipc').ShieldStepState[]; overallProgress: number };
          updateShieldSteps(targetId, steps, overallProgress);
          return;
        }
        if (type === 'setup:step_log') {
          const { targetId: stTargetId, stepId: stStepId, message: stMsg } = data as { targetId: string; stepId: string; message: string };
          if (stTargetId && stStepId && stMsg) {
            appendStepLog(stTargetId, stStepId, stMsg);
          }
          return;
        }
        if (type === 'setup:shield_progress') {
          const { targetId, step, progress, message } = data as { targetId: string; step: string; progress: number; message?: string };
          updateShieldProgress(targetId, step, progress, message);
          // Fall through to addEvent() — milestone event, ~15 per target
        }
        if (type === 'setup:shield_complete') {
          const { targetId, profileId } = data as { targetId: string; profileId: string };
          markShieldComplete(targetId, profileId);
          // Target watcher now handles SSE push — no query invalidation needed
          // Fall through to addEvent() — one per target, critical milestone
        }
        if (type === 'setup:error') {
          const { targetId: errorTargetId, error: errorMsg, step: errorStep } = data as { targetId?: string; error: string; step?: string };
          if (errorTargetId) {
            markShieldError(errorTargetId, errorMsg, errorStep);
          }
          // Fall through to addEvent() — error is a critical milestone event
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

        // Invalidate policy + config queries when policies change (e.g. cloud push)
        if (type === 'config:policies_updated' || type === 'config:changed') {
          queryClient.invalidateQueries({ queryKey: queryKeys.config });
          queryClient.invalidateQueries({ queryKey: queryKeys.tieredPolicies });
          // Fall through to addEvent()
        }

        // Route skill events to the skills store (don't return — let them also flow into activity feed)
        if (type.startsWith('skills:')) {
          handleSkillSSEEvent(type, data);
          // Invalidate skill env requirements when installed skills or analyses change
          if (SKILL_ENV_EVENTS.has(type)) {
            queryClient.invalidateQueries({ queryKey: queryKeys.skillEnvRequirements });
          }
        }

        // Extract source and profileId tags from the daemon event wrapper
        const source = rawData && typeof rawData === 'object' && 'source' in rawData
          ? (rawData.source as string)
          : undefined;
        const profileId = rawData && typeof rawData === 'object' && 'profileId' in rawData
          ? (rawData.profileId as string)
          : undefined;

        const event: SSEEvent = {
          id: crypto.randomUUID(),
          type,
          data,
          timestamp: serverTs,
          source,
          profileId,
        };
        addEvent(event);
      },
      (isConnected) => {
        setConnected(isConnected);
        if (isConnected) {
          // Refresh skills on reconnect to catch any events missed during disconnect
          fetchInstalledSkills();

          // Reset store loaded flags so one-shot REST fetches re-fire
          securityStore.loaded = false;
          alertsStore.loaded = false;
          targetsStore.loaded = false;
          // systemStore doesn't need reset — stale metrics are acceptable until next push (<=10s)

          // Recover in-progress shield operations (survives page refresh)
          targetsApi.activeOperations().then((res) => {
            if (res.data?.length > 0) {
              for (const op of res.data) {
                updateShieldSteps(op.targetId, op.steps, op.progress);
              }
            }
          }).catch(() => { /* non-fatal */ });

          // Load history once on first successful connection
          if (!historyLoaded.current) {
            historyLoaded.current = true;
            api.getActivity(500, scopeStore.profileId ?? undefined).then((res) => {
              const historical: SSEEvent[] = res.data.map((e: Record<string, unknown>) => ({
                id: crypto.randomUUID(),
                type: e.type as string,
                data: ((e.data ?? {}) as Record<string, unknown>),
                timestamp: new Date(e.timestamp as string).getTime(),
                source: e.source as string | undefined,
                profileId: e.profileId as string | undefined,
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
