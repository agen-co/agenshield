/**
 * React Query hooks for AgenShield API
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSnapshot } from 'valtio';
import type { UpdateConfigRequest, SimulateRequest } from '@agenshield/ipc';
import { api, type CreateSecretRequest } from './client';
import { daemonStatusStore } from '../state/daemon-status';
import { securityStore, setSecurityStatus } from '../state/security';
import { alertsStore, setAlerts, acknowledgeAlertInStore, acknowledgeAllAlertsInStore } from '../state/alerts';
import { systemStore, handleMetricsSnapshot } from '../state/system-store';
import { scopeStore } from '../state/scope';

// Query keys
export const queryKeys = {
  health: ['health'] as const,
  config: ['config'] as const,
  skills: ['skills'] as const,
  secrets: ['secrets'] as const,
  availableEnvSecrets: ['secrets', 'env'] as const,
  skillEnvRequirements: ['secrets', 'skill-env'] as const,
  security: ['security'] as const,
  alerts: ['alerts'] as const,
  alertsCount: ['alerts', 'count'] as const,
  agencoStatus: ['agenco', 'status'] as const,
  agencoMCPStatus: ['agenco', 'mcp-status'] as const,
  agencoIntegrations: ['agenco', 'integrations'] as const,
  agencoConnected: ['agenco', 'connected'] as const,
  agencoSkillStatus: ['agenco', 'skill-status'] as const,
  profiles: ['profiles'] as const,
  fsBrowse: (dirPath: string) => ['fs', 'browse', dirPath] as const,
};

/**
 * Build a scope-aware query key. Scope headers are sent automatically by the API client,
 * but including scope in the key ensures React Query refetches when scope changes.
 */
function useScopeKey() {
  const { profileId } = useSnapshot(scopeStore);
  return { profileId };
}

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
    retry: 3,
    retryDelay: 2000,
    staleTime: 15_000,
  });
}

/**
 * Returns the server mode. Always 'daemon' — setup mode has been removed.
 * Kept for backwards compatibility with components that check the mode.
 */
export function useServerMode(): string {
  return 'daemon';
}

/**
 * Returns true when the daemon is healthy and queries are safe to fire.
 */
export function useHealthGate() {
  const { data, isLoading } = useHealth();
  // Keep the gate open if we have cached data from a previous success,
  // even if a background refetch is currently failing.
  return !!data && !isLoading;
}

/**
 * Hook to get daemon status (pushed via SSE, no polling)
 */
export function useStatus() {
  const { status } = useSnapshot(daemonStatusStore);
  return {
    data: status ? { data: status } : undefined,
    isLoading: !status,
  };
}

/**
 * Hook to fetch configuration
 */
export function useConfig() {
  const healthy = useHealthGate();
  const scope = useScopeKey();
  return useQuery({
    queryKey: [...queryKeys.config, scope] as const,
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

// --- System bins & allowed commands hooks ---

export function useSystemBins() {
  const healthy = useHealthGate();
  return useQuery({
    queryKey: ['system-bins'] as const,
    queryFn: api.getSystemBins,
    enabled: healthy,
    staleTime: 60_000, // Cache for 60 seconds
  });
}

export function useAllowedCommands() {
  const healthy = useHealthGate();
  return useQuery({
    queryKey: ['allowed-commands'] as const,
    queryFn: api.getAllowedCommands,
    enabled: healthy,
  });
}

export function useDiscovery() {
  const healthy = useHealthGate();
  return useQuery({
    queryKey: ['discovery'] as const,
    queryFn: () => api.getDiscovery(),
    enabled: healthy,
    staleTime: 60_000,
  });
}

// --- Secrets hooks ---

export function useSecrets() {
  const healthy = useHealthGate();
  const scope = useScopeKey();
  return useQuery({
    queryKey: [...queryKeys.secrets, scope] as const,
    queryFn: api.getSecrets,
    enabled: healthy,
  });
}

export function useAvailableEnvSecrets() {
  const healthy = useHealthGate();
  return useQuery({
    queryKey: queryKeys.availableEnvSecrets,
    queryFn: api.getAvailableEnvSecrets,
    enabled: healthy,
    staleTime: 60_000, // env vars rarely change during a session
  });
}

export function useSkillEnvRequirements() {
  const healthy = useHealthGate();
  return useQuery({
    queryKey: queryKeys.skillEnvRequirements,
    queryFn: api.getSkillEnvRequirements,
    enabled: healthy,
    staleTime: 30_000,
  });
}

export function useCreateSecret() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateSecretRequest) => api.createSecret(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.secrets });
      queryClient.invalidateQueries({ queryKey: queryKeys.skillEnvRequirements });
    },
  });
}

export function useDeleteSecret() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.deleteSecret(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.secrets });
      queryClient.invalidateQueries({ queryKey: queryKeys.skillEnvRequirements });
    },
  });
}

export function useUpdateSecret() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, policyIds }: { id: string; policyIds: string[] }) =>
      api.updateSecret(id, { policyIds }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.secrets });
      queryClient.invalidateQueries({ queryKey: queryKeys.config });
    },
  });
}

// --- Security hooks ---

export function useSecurity() {
  const healthy = useHealthGate();
  const { status, loaded } = useSnapshot(securityStore);

  // One-time REST fetch to seed store before first SSE event
  useQuery({
    queryKey: queryKeys.security,
    queryFn: async () => {
      const res = await api.getSecurity();
      if (res.data) setSecurityStatus(res.data);
      return res;
    },
    enabled: healthy && !loaded,
    staleTime: Infinity,
  });

  return {
    // Cast away valtio's readonly wrapper — consumers expect mutable types
    data: status ? { data: status as unknown as import('@agenshield/ipc').SecurityStatusPayload } : undefined,
    isLoading: !loaded,
  };
}

// --- AgenCo hooks ---

export function useAgenCoStatus() {
  const healthy = useHealthGate();
  return useQuery({
    queryKey: queryKeys.agencoStatus,
    queryFn: api.agenco.getAuthStatus,
    enabled: healthy,
    refetchInterval: healthy ? 15000 : false,
  });
}

export function useAgenCoMCPStatus() {
  const healthy = useHealthGate();
  return useQuery({
    queryKey: queryKeys.agencoMCPStatus,
    queryFn: api.agenco.getMCPStatus,
    enabled: healthy,
    refetchInterval: healthy ? 10000 : false,
  });
}

export function useAgenCoIntegrations(category?: string, search?: string) {
  const healthy = useHealthGate();
  return useQuery({
    queryKey: [...queryKeys.agencoIntegrations, category, search],
    queryFn: () => api.agenco.listIntegrations(category, search),
    enabled: healthy,
  });
}

export function useAgenCoConnectedIntegrations() {
  const healthy = useHealthGate();
  return useQuery({
    queryKey: queryKeys.agencoConnected,
    queryFn: api.agenco.listConnectedIntegrations,
    enabled: healthy,
  });
}

export function useAgenCoLogout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.agenco.logout(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.agencoStatus });
      queryClient.invalidateQueries({ queryKey: queryKeys.agencoMCPStatus });
      queryClient.invalidateQueries({ queryKey: queryKeys.agencoConnected });
    },
  });
}

export function useAgenCoConnectIntegration() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { integration: string; scopes?: string[] }) =>
      api.agenco.connectIntegration(data.integration, data.scopes),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.agencoConnected });
      queryClient.invalidateQueries({ queryKey: queryKeys.agencoIntegrations });
    },
  });
}

export function useAgenCoDisconnectIntegration() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (integration: string) =>
      api.agenco.disconnectIntegration(integration),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.agencoConnected });
      queryClient.invalidateQueries({ queryKey: queryKeys.agencoIntegrations });
      queryClient.invalidateQueries({ queryKey: queryKeys.agencoSkillStatus });
      queryClient.invalidateQueries({ queryKey: queryKeys.skills });
    },
  });
}

export function useAgenCoSkillStatus() {
  const healthy = useHealthGate();
  return useQuery({
    queryKey: queryKeys.agencoSkillStatus,
    queryFn: api.agenco.getSkillStatus,
    enabled: healthy,
    refetchInterval: healthy ? 15000 : false,
  });
}

export function useAgenCoSyncSkills() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.agenco.syncSkills(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.agencoSkillStatus });
      queryClient.invalidateQueries({ queryKey: queryKeys.skills });
    },
  });
}

// --- Factory reset hook ---

export function useFactoryReset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.factoryReset(),
    onSuccess: () => {
      queryClient.invalidateQueries();
    },
  });
}

// --- OpenClaw hooks ---

export function useOpenClawStatus() {
  const healthy = useHealthGate();
  return useQuery({
    queryKey: ['openclaw', 'status'],
    queryFn: api.openclaw.getStatus,
    enabled: healthy,
    refetchInterval: healthy ? 10000 : false,
  });
}

export function useOpenClawAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (action: 'start' | 'stop' | 'restart') => api.openclaw[action](),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['openclaw', 'status'] });
      // Refetch again after a short delay to catch async state change
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['openclaw', 'status'] });
      }, 2000);
    },
  });
}

export function useOpenClawDashboardUrl() {
  return useMutation({
    mutationFn: () => api.openclaw.getDashboardUrl(),
  });
}

// --- Filesystem browse hooks ---

export function useBrowsePath(dirPath: string | null) {
  const healthy = useHealthGate();
  return useQuery({
    queryKey: queryKeys.fsBrowse(dirPath ?? ''),
    queryFn: () => api.browsePath(dirPath ?? undefined),
    enabled: healthy && dirPath !== null,
    staleTime: 10_000,
  });
}

// --- System metrics hook ---

export function useSystemMetrics() {
  const healthy = useHealthGate();
  const { metricsLoaded } = useSnapshot(systemStore);

  // One-time REST fetch to seed store before first SSE event
  useQuery({
    queryKey: ['system-metrics-initial'] as const,
    queryFn: async () => {
      const res = await api.getMetrics();
      if (res.data) handleMetricsSnapshot(res.data);
      return res;
    },
    enabled: healthy && !metricsLoaded,
    staleTime: Infinity,
  });

  return { data: undefined, isLoading: !metricsLoaded };
}

/**
 * Fetch metrics history from the daemon (persisted SQLite snapshots).
 * Runs once on mount to backfill the valtio metricsHistory buffer.
 */
export function useMetricsHistory(limit = 150) {
  const healthy = useHealthGate();
  return useQuery({
    queryKey: ['metrics-history', limit] as const,
    queryFn: async () => {
      const res = await fetch(`/api/metrics/history?limit=${limit}`);
      if (!res.ok) return [];
      const json = await res.json();
      return (json.data ?? []) as Array<{
        timestamp: number;
        cpuPercent: number;
        memPercent: number;
        diskPercent: number;
        netUp: number;
        netDown: number;
      }>;
    },
    enabled: healthy,
    staleTime: 60_000, // Refetch at most once per minute
  });
}

/**
 * Fetch per-target metrics history from the daemon.
 * Only fetches when a targetId is selected and health gate is open.
 */
export function useTargetMetricsHistory(targetId: string | null) {
  const healthy = useHealthGate();
  return useQuery({
    queryKey: ['metrics-history', 'target', targetId] as const,
    queryFn: async () => {
      const res = await fetch(`/api/metrics/history?targetId=${encodeURIComponent(targetId!)}&limit=150`);
      if (!res.ok) return [];
      const json = await res.json();
      return (json.data ?? []) as Array<{
        timestamp: number;
        cpuPercent: number;
        memPercent: number;
        diskPercent: number;
        netUp: number;
        netDown: number;
        targetId?: string;
      }>;
    },
    enabled: healthy && !!targetId,
    staleTime: 60_000,
  });
}

// --- Alerts hooks ---

export function useAlerts() {
  const healthy = useHealthGate();
  const { alerts, loaded } = useSnapshot(alertsStore);

  // One-time REST fetch to seed store before first SSE event
  useQuery({
    queryKey: queryKeys.alerts,
    queryFn: async () => {
      const res = await api.alerts.getAll({ includeAcknowledged: true });
      if (res.data) setAlerts(res.data, res.meta?.unacknowledgedCount ?? 0);
      return res;
    },
    enabled: healthy && !loaded,
    staleTime: Infinity,
  });

  return {
    data: loaded ? { data: alerts as import('@agenshield/ipc').Alert[], meta: { unacknowledgedCount: alertsStore.unacknowledgedCount } } : undefined,
    isLoading: !loaded,
  };
}

export function useAlertsCount() {
  const { unacknowledgedCount, loaded } = useSnapshot(alertsStore);

  return {
    data: loaded ? { data: { count: unacknowledgedCount } } : undefined,
    isLoading: !loaded,
  };
}

export function useAcknowledgeAlert() {
  return useMutation({
    mutationFn: (id: number) => api.alerts.acknowledge(id),
    onMutate: (id) => {
      // Optimistic update
      acknowledgeAlertInStore(id);
    },
  });
}

export function useAcknowledgeAllAlerts() {
  return useMutation({
    mutationFn: () => api.alerts.acknowledgeAll(),
    onMutate: () => {
      // Optimistic update
      acknowledgeAllAlertsInStore();
    },
  });
}

// --- Playground hooks ---

export function useSimulate() {
  return useMutation({
    mutationFn: (data: SimulateRequest) => api.playground.simulate(data),
  });
}

// --- Profile hooks ---

export function useProfiles() {
  const healthy = useHealthGate();
  return useQuery({
    queryKey: queryKeys.profiles,
    queryFn: api.getProfiles,
    enabled: healthy,
  });
}
