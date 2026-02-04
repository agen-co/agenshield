/**
 * React Query hooks for AgenShield API
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { UpdateConfigRequest } from '@agenshield/ipc';
import { api, type CreateSecretRequest } from './client';

// Query keys
export const queryKeys = {
  health: ['health'] as const,
  status: ['status'] as const,
  config: ['config'] as const,
  skills: ['skills'] as const,
  skill: (name: string) => ['skills', name] as const,
  secrets: ['secrets'] as const,
  security: ['security'] as const,
};

/**
 * Hook to fetch daemon health status.
 * This is the single source of truth for daemon connectivity.
 * All other queries should use `useHealthGate()` to determine if they should run.
 */
export function useHealth() {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: api.getHealth,
    refetchInterval: (query) => (query.state.status === 'error' ? 10000 : 30000),
    retry: 1,
  });
}

/**
 * Returns true when the daemon is healthy and queries are safe to fire.
 */
export function useHealthGate() {
  const { data, isError, isLoading } = useHealth();
  return !isError && !isLoading && !!data;
}

/**
 * Hook to fetch daemon status
 */
export function useStatus() {
  const healthy = useHealthGate();
  return useQuery({
    queryKey: queryKeys.status,
    queryFn: api.getStatus,
    enabled: healthy,
    refetchInterval: healthy ? 5000 : false,
  });
}

/**
 * Hook to fetch configuration
 */
export function useConfig() {
  const healthy = useHealthGate();
  return useQuery({
    queryKey: queryKeys.config,
    queryFn: api.getConfig,
    enabled: healthy,
  });
}

/**
 * Hook to update configuration
 */
export function useUpdateConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: UpdateConfigRequest) => api.updateConfig(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.config });
    },
  });
}

// --- Skills hooks ---

export function useSkills() {
  const healthy = useHealthGate();
  return useQuery({
    queryKey: queryKeys.skills,
    queryFn: api.getSkills,
    enabled: healthy,
  });
}

export function useSkill(name: string | null) {
  const healthy = useHealthGate();
  return useQuery({
    queryKey: queryKeys.skill(name ?? ''),
    queryFn: () => api.getSkill(name!),
    enabled: healthy && !!name,
  });
}

export function useToggleSkill() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (name: string) => api.toggleSkill(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.skills });
    },
  });
}

export function useActivateSkill() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (name: string) => api.activateSkill(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.skills });
    },
  });
}

export function useQuarantineSkill() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (name: string) => api.quarantineSkill(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.skills });
    },
  });
}

// --- Secrets hooks ---

export function useSecrets() {
  const healthy = useHealthGate();
  return useQuery({
    queryKey: queryKeys.secrets,
    queryFn: api.getSecrets,
    enabled: healthy,
  });
}

export function useCreateSecret() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateSecretRequest) => api.createSecret(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.secrets });
    },
  });
}

export function useDeleteSecret() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.deleteSecret(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.secrets });
    },
  });
}

// --- Security hooks ---

export function useSecurity() {
  const healthy = useHealthGate();
  return useQuery({
    queryKey: queryKeys.security,
    queryFn: api.getSecurity,
    enabled: healthy,
    refetchInterval: healthy ? 30000 : false,
  });
}
