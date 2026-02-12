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
        const serverTs =
          rawData && typeof rawData === 'object' && 'timestamp' in rawData
            ? new Date(rawData.timestamp as string).getTime()
            : Date.now();

        // Update daemon status store from SSE push
        if (type === 'daemon:status') {
          setDaemonStatus(data as unknown as DaemonStatus);
          return; // Don't add status events to the activity feed
        }

        // Route skill events to the skills store (don't return — let them also flow into activity feed)
        if (type.startsWith('skills:')) {
          handleSkillSSEEvent(type, data);
          // Invalidate skill env requirements when installed skills or analyses change
          if (SKILL_ENV_EVENTS.has(type)) {
            queryClient.invalidateQueries({ queryKey: queryKeys.skillEnvRequirements });
          }
        }

        const event: SSEEvent = {
          id: crypto.randomUUID(),
          type,
          data,
          timestamp: serverTs,
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
              const historical: SSEEvent[] = res.data.map((e) => ({
                id: crypto.randomUUID(),
                type: e.type,
                data: (e.data ?? {}) as Record<string, unknown>,
                timestamp: new Date(e.timestamp).getTime(),
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
