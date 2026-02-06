/**
 * React Query hooks for AgenShield API
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { UpdateConfigRequest } from '@agenshield/ipc';
import { api, type CreateSecretRequest } from './client';
import type { AnalyzeSkillRequestUnion, InstallSkillRequest } from './marketplace.types';

// Query keys
export const queryKeys = {
  health: ['health'] as const,
  status: ['status'] as const,
  config: ['config'] as const,
  skills: ['skills'] as const,
  skill: (name: string) => ['skills', name] as const,
  secrets: ['secrets'] as const,
  availableEnvSecrets: ['secrets', 'env'] as const,
  security: ['security'] as const,
  agencoStatus: ['agenco', 'status'] as const,
  agencoMCPStatus: ['agenco', 'mcp-status'] as const,
  agencoIntegrations: ['agenco', 'integrations'] as const,
  agencoConnected: ['agenco', 'connected'] as const,
  marketplaceSearch: (query: string) => ['marketplace', 'search', query] as const,
  marketplaceSkill: (slug: string) => ['marketplace', 'skill', slug] as const,
  marketplaceCachedAnalysis: (skillName: string, publisher: string) =>
    ['marketplace', 'cachedAnalysis', skillName, publisher] as const,
  fsBrowse: (dirPath: string) => ['fs', 'browse', dirPath] as const,
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
 * Returns the server mode from the health endpoint.
 * 'setup' when served by setup server, 'daemon' when served by daemon.
 */
export function useServerMode() {
  const { data } = useHealth();
  return data?.data?.mode;
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

// --- Skill analysis hooks ---

export function useReanalyzeSkill() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ name, content, metadata }: { name: string; content?: string; metadata?: Record<string, unknown> }) =>
      api.reanalyzeSkill(name, content, metadata),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.skill(variables.name) });
    },
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
  return useQuery({
    queryKey: queryKeys.secrets,
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
  return useQuery({
    queryKey: queryKeys.security,
    queryFn: api.getSecurity,
    enabled: healthy,
    refetchInterval: healthy ? 30000 : false,
  });
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

// --- Marketplace hooks ---

export function useMarketplaceSearch(query: string) {
  return useQuery({
    queryKey: queryKeys.marketplaceSearch(query),
    queryFn: () => api.marketplace.search(query),
    enabled: query.length >= 2,
    staleTime: 300_000,
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
  });
}

export function useMarketplaceSkill(slug: string | null) {
  return useQuery({
    queryKey: queryKeys.marketplaceSkill(slug ?? ''),
    queryFn: () => api.marketplace.getSkill(slug!),
    enabled: !!slug,
    staleTime: 300_000,
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev, // Keep previous data while refetching
    refetchInterval: (query) => {
      const data = query.state.data;
      // Poll every 3 seconds while analysis is pending
      if (data?.data?.analysisStatus === 'pending') return 3000;
      return false;
    },
  });
}

export function useAnalyzeMarketplaceSkill() {
  return useMutation({
    mutationFn: (data: AnalyzeSkillRequestUnion) => api.marketplace.analyzeSkill(data),
  });
}

export function useCachedAnalysis(skillName: string | null, publisher: string | null) {
  return useQuery({
    queryKey: queryKeys.marketplaceCachedAnalysis(skillName ?? '', publisher ?? ''),
    queryFn: () => api.marketplace.getCachedAnalysis(skillName!, publisher!),
    enabled: !!skillName && !!publisher,
    staleTime: 300_000,
    retry: false,
  });
}

export function useInstallMarketplaceSkill() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: InstallSkillRequest) => api.marketplace.installSkill(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.skills });
      queryClient.invalidateQueries({ queryKey: ['marketplace', 'search'] });
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
