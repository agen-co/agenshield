/**
 * API client and React Query hooks for Setup Wizard endpoints
 */

import { useQuery, useMutation } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { setupStore, type SetupPhase } from '../state/setup';
import type { ExecutableInfo } from '../state/setup';

const BASE_URL = '/api';

async function setupRequest<T>(endpoint: string, options?: RequestInit): Promise<T> {
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

export const setupApi = {
  getState: () =>
    setupRequest<{
      success: boolean;
      data: { state: unknown; context: Record<string, unknown>; phase: string };
    }>('/setup/state'),

  configure: (mode: 'quick' | 'advanced', baseName?: string) =>
    setupRequest<{ success: boolean; data: { mode: string; baseName: string; names: Record<string, string> } }>(
      '/setup/configure',
      { method: 'POST', body: JSON.stringify({ mode, baseName }) },
    ),

  checkConflicts: (baseName: string) =>
    setupRequest<{
      success: boolean;
      data: {
        hasConflicts: boolean;
        users: string[];
        groups: string[];
        names: Record<string, string>;
      };
    }>('/setup/check-conflicts', {
      method: 'POST',
      body: JSON.stringify({ baseName }),
    }),

  confirm: () =>
    setupRequest<{ success: boolean; data: { started: boolean } }>('/setup/confirm', {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  setPasscode: (passcode?: string, skip?: boolean) =>
    setupRequest<{ success: boolean; data: { started: boolean } }>('/setup/passcode', {
      method: 'POST',
      body: JSON.stringify({ passcode, skip }),
    }),

  getExecutables: () =>
    setupRequest<{ success: boolean; data: { executables: ExecutableInfo[] } }>(
      '/setup/executables',
    ),

  installTarget: () =>
    setupRequest<{
      success: boolean;
      data: { installed: boolean; preset: string; version?: string };
    }>('/setup/install-target', { method: 'POST', body: JSON.stringify({}) }),
};

// --- React Query hooks ---

export function useSetupState() {
  return useQuery({
    queryKey: ['setup', 'state'],
    queryFn: setupApi.getState,
    refetchInterval: 5000,
  });
}

export function useConfigure() {
  return useMutation({
    mutationFn: ({ mode, baseName }: { mode: 'quick' | 'advanced'; baseName?: string }) =>
      setupApi.configure(mode, baseName),
  });
}

export function useCheckConflicts() {
  return useMutation({
    mutationFn: (baseName: string) => setupApi.checkConflicts(baseName),
  });
}

export function useConfirmSetup() {
  return useMutation({
    mutationFn: () => setupApi.confirm(),
  });
}

export function useSetPasscode() {
  return useMutation({
    mutationFn: ({ passcode, skip }: { passcode?: string; skip?: boolean }) =>
      setupApi.setPasscode(passcode, skip),
  });
}

export function useInstallTarget() {
  return useMutation({
    mutationFn: () => setupApi.installTarget(),
  });
}

export function useExecutables() {
  return useQuery({
    queryKey: ['setup', 'executables'],
    queryFn: setupApi.getExecutables,
    staleTime: 60_000,
  });
}

// --- SSE hook for setup events ---

export function useSetupSSE() {
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource('/sse/events');
    sourceRef.current = es;

    const handleStateChange = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        if (data.state) {
          setupStore.wizardState = data.state;
          // Update completed steps
          if (data.state.steps) {
            setupStore.completedEngineSteps = data.state.steps
              .filter((s: { status: string }) => s.status === 'completed')
              .map((s: { id: string }) => s.id);
          }
        }
        if (data.context) {
          setupStore.context = data.context;
        }
        if (data.phase) {
          setupStore.phase = data.phase as SetupPhase;
        }
      } catch {
        // ignore parse errors
      }
    };

    const handleComplete = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        setupStore.phase = 'complete';
        setupStore.graphPhase = 'secured';
        if (data.state) setupStore.wizardState = data.state;
        if (data.context) setupStore.context = data.context;
      } catch {
        // ignore
      }
    };

    const handleError = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        if (data.error) {
          console.error('Setup error:', data.error);
        }
      } catch {
        // ignore
      }
    };

    es.addEventListener('setup:state_change', handleStateChange);
    es.addEventListener('setup:complete', handleComplete);
    es.addEventListener('setup:error', handleError);

    es.onerror = () => {
      // Reconnection is handled automatically by EventSource
    };

    return () => {
      es.close();
      sourceRef.current = null;
    };
  }, []);
}
