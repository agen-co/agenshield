/**
 * API client and React Query hooks for Update endpoints
 */

import { useQuery, useMutation } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { subscribe } from 'valtio';
import { updateStore, type UpdatePhase } from '../state/update';
import { eventStore } from '../state/events';

const BASE_URL = '/api';

async function updateRequest<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error?.message || `API Error: ${res.status}`);
  }
  return res.json();
}

// --- API client ---

export const updateApi = {
  getState: () =>
    updateRequest<{
      success: boolean;
      data: {
        state: {
          fromVersion: string;
          toVersion: string;
          steps: Array<{
            id: string;
            name: string;
            description: string;
            status: 'pending' | 'running' | 'completed' | 'error' | 'skipped';
            error?: string;
            isMigration?: boolean;
            migrationVersion?: string;
          }>;
          isComplete: boolean;
          hasError: boolean;
          releaseNotes: string;
          authRequired: boolean;
          authenticated: boolean;
        };
        releaseNotes: string;
        authRequired: boolean;
        authenticated: boolean;
      };
    }>('/update/state'),

  authenticate: (passcode: string) =>
    updateRequest<{ success: boolean; data: { authenticated: boolean } }>(
      '/update/authenticate',
      { method: 'POST', body: JSON.stringify({ passcode }) },
    ),

  getReleaseNotes: () =>
    updateRequest<{ success: boolean; data: { releaseNotes: string } }>(
      '/update/release-notes',
    ),

  confirm: () =>
    updateRequest<{ success: boolean; data: { started: boolean } }>(
      '/update/confirm',
      { method: 'POST', body: JSON.stringify({}) },
    ),
};

// --- React Query hooks ---

export function useUpdateState() {
  return useQuery({
    queryKey: ['update', 'state'],
    queryFn: updateApi.getState,
    refetchInterval: 5000,
  });
}

export function useAuthenticate() {
  return useMutation({
    mutationFn: (passcode: string) => updateApi.authenticate(passcode),
  });
}

export function useConfirmUpdate() {
  return useMutation({
    mutationFn: () => updateApi.confirm(),
  });
}

// --- SSE hook for update events ---
// Subscribes to the main eventStore (populated by useSSE in App.tsx)
// instead of creating a duplicate EventSource connection.

export function useUpdateSSE() {
  const lastEventCount = useRef(eventStore.events.length);

  useEffect(() => {
    const unsub = subscribe(eventStore, () => {
      const currentCount = eventStore.events.length;
      if (currentCount <= lastEventCount.current) {
        lastEventCount.current = currentCount;
        return;
      }

      const newCount = currentCount - lastEventCount.current;
      const newEvents = eventStore.events.slice(0, newCount);
      lastEventCount.current = currentCount;

      for (const event of newEvents) {
        const data = event.data as Record<string, unknown>;

        if (event.type === 'update:state') {
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
        } else if (event.type === 'update:log') {
          if (data.stepId && data.message) {
            updateStore.stepLogs[data.stepId as string] = data.message as string;
          }
        } else if (event.type === 'update:complete') {
          updateStore.phase = 'complete';
          if (data.state) updateStore.updateState = data.state as NonNullable<typeof updateStore.updateState>;
        } else if (event.type === 'update:error') {
          updateStore.phase = 'error';
          if (data.state) updateStore.updateState = data.state as NonNullable<typeof updateStore.updateState>;
          if (data.error) console.error('Update error:', data.error);
        }
      }
    });

    return unsub;
  }, []);
}
