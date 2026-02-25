/**
 * API client and React Query hooks for Target Lifecycle endpoints
 */

import { useQuery, useMutation } from '@tanstack/react-query';
import { useSnapshot } from 'valtio';
import { targetsStore, setTargets } from '../state/targets';
import { useHealthGate } from './hooks';
import { authFetch } from './client';
import type { TargetStatusInfo, ShieldStepState } from '@agenshield/ipc';

export interface ActiveOperationInfo {
  targetId: string;
  targetName: string;
  startedAt: string;
  status: 'in_progress';
  progress: number;
  currentStep?: string;
  steps: ShieldStepState[];
}

const BASE_URL = '/api';

async function targetRequest<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const res = await authFetch(`${BASE_URL}${endpoint}`, {
    ...options,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error?.message || `API Error: ${res.status}`);
  }
  return res.json();
}

export const targetsApi = {
  list: () =>
    targetRequest<{ success: boolean; data: TargetStatusInfo[] }>('/targets/lifecycle'),

  detect: () =>
    targetRequest<{ success: boolean; data: unknown[] }>('/targets/lifecycle/detect', {
      method: 'POST',
    }),

  shield: (targetId: string, baseName?: string, openclawVersion?: string) =>
    targetRequest<{ success: boolean; data: { targetId: string; profileId: string } }>(
      `/targets/lifecycle/${targetId}/shield`,
      { method: 'POST', body: JSON.stringify({ baseName, openclawVersion }) },
    ),

  unshield: (targetId: string) =>
    targetRequest<{ success: boolean; data: { targetId: string; unshielded: boolean } }>(
      `/targets/lifecycle/${targetId}/unshield`,
      { method: 'POST' },
    ),

  start: (targetId: string) =>
    targetRequest<{ success: boolean; data: { targetId: string; started: boolean } }>(
      `/targets/lifecycle/${targetId}/start`,
      { method: 'POST' },
    ),

  stop: (targetId: string) =>
    targetRequest<{ success: boolean; data: { targetId: string; stopped: boolean } }>(
      `/targets/lifecycle/${targetId}/stop`,
      { method: 'POST' },
    ),

  activeOperations: () =>
    targetRequest<{ success: boolean; data: ActiveOperationInfo[] }>('/targets/lifecycle/active-operations'),
};

// --- React Query hooks ---

export function useTargets() {
  const healthy = useHealthGate();
  const { targets, loaded } = useSnapshot(targetsStore);

  // One-time REST fetch to seed store before first SSE event
  const query = useQuery({
    queryKey: ['targets', 'lifecycle'],
    queryFn: async () => {
      const res = await targetsApi.list();
      if (res.data) setTargets(res.data);
      return res;
    },
    enabled: healthy && !loaded,
    staleTime: Infinity,
  });

  return {
    data: loaded ? { success: true, data: targets as TargetStatusInfo[] } : undefined,
    isLoading: !loaded,
    refetch: query.refetch,
  };
}

export function useDetectTargets() {
  return useMutation({
    mutationFn: () => targetsApi.detect(),
  });
}

export function useShieldTarget() {
  return useMutation({
    mutationFn: ({ targetId, baseName, openclawVersion }: { targetId: string; baseName?: string; openclawVersion?: string }) =>
      targetsApi.shield(targetId, baseName, openclawVersion),
    // Target watcher handles SSE push — no query invalidation needed
  });
}

export function useUnshieldTarget() {
  return useMutation({
    mutationFn: (targetId: string) => targetsApi.unshield(targetId),
  });
}

export function useStartTarget() {
  return useMutation({
    mutationFn: (targetId: string) => targetsApi.start(targetId),
  });
}

export function useStopTarget() {
  return useMutation({
    mutationFn: (targetId: string) => targetsApi.stop(targetId),
  });
}
