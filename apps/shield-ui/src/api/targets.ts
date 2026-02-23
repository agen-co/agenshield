/**
 * API client and React Query hooks for Target Lifecycle endpoints
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

const BASE_URL = '/api';

interface TargetInfo {
  id: string;
  name: string;
  type: string;
  shielded: boolean;
  running: boolean;
  version?: string;
  binaryPath?: string;
}

async function targetRequest<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const headers: HeadersInit = {};
  if (options?.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    headers,
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
    targetRequest<{ success: boolean; data: TargetInfo[] }>('/targets/lifecycle'),

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
};

// --- React Query hooks ---

export function useTargets(polling = true) {
  return useQuery({
    queryKey: ['targets', 'lifecycle'],
    queryFn: targetsApi.list,
    refetchInterval: polling ? 5000 : false,
  });
}

export function useDetectTargets() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => targetsApi.detect(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['targets', 'lifecycle'] }),
  });
}

export function useShieldTarget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ targetId, baseName, openclawVersion }: { targetId: string; baseName?: string; openclawVersion?: string }) =>
      targetsApi.shield(targetId, baseName, openclawVersion),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['targets', 'lifecycle'] }),
  });
}

export function useUnshieldTarget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (targetId: string) => targetsApi.unshield(targetId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['targets', 'lifecycle'] }),
  });
}

export function useStartTarget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (targetId: string) => targetsApi.start(targetId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['targets', 'lifecycle'] }),
  });
}

export function useStopTarget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (targetId: string) => targetsApi.stop(targetId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['targets', 'lifecycle'] }),
  });
}
