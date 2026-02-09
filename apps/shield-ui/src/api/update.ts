/**
 * API client and React Query hooks for Update endpoints
 */

import { useQuery, useMutation } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { updateStore, type UpdatePhase } from '../state/update';

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

export function useUpdateSSE() {
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource('/sse/events');
    sourceRef.current = es;

    const handleState = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        if (data.state) {
          updateStore.updateState = data.state;
          // Update completed steps
          if (data.state.steps) {
            const completed = data.state.steps
              .filter((s: { status: string }) => s.status === 'completed')
              .map((s: { id: string }) => s.id);
            updateStore.completedSteps = completed;

            // Clear stepLogs for finished steps
            for (const step of data.state.steps as { id: string; status: string }[]) {
              if (step.status === 'completed' || step.status === 'error') {
                delete updateStore.stepLogs[step.id];
              }
            }
          }
        }
      } catch { /* ignore */ }
    };

    const handleLog = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        if (data.stepId && data.message) {
          updateStore.stepLogs[data.stepId] = data.message;
        }
      } catch { /* ignore */ }
    };

    const handleComplete = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        updateStore.phase = 'complete';
        if (data.state) updateStore.updateState = data.state;
      } catch { /* ignore */ }
    };

    const handleError = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        updateStore.phase = 'error';
        if (data.state) updateStore.updateState = data.state;
        if (data.error) console.error('Update error:', data.error);
      } catch { /* ignore */ }
    };

    es.addEventListener('update:state', handleState);
    es.addEventListener('update:log', handleLog);
    es.addEventListener('update:complete', handleComplete);
    es.addEventListener('update:error', handleError);

    es.onerror = () => {
      // Reconnection handled automatically
    };

    return () => {
      es.close();
      sourceRef.current = null;
    };
  }, []);
}
