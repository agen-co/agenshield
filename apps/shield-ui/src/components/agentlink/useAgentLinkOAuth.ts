/**
 * OAuth popup hook for AgentLink authentication
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { queryKeys } from '../../api/hooks';

export function useAgentLinkOAuth() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const popupRef = useRef<Window | null>(null);

  // Clean up popup on unmount
  useEffect(() => {
    return () => {
      if (popupRef.current && !popupRef.current.closed) {
        popupRef.current.close();
      }
    };
  }, []);

  const startAuth = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await api.agentlink.startAuth(undefined, 'ui');
      if (!res.success || !res.data?.authUrl) {
        throw new Error(res.error || 'Failed to start auth flow');
      }

      // Open popup first with blank (avoids popup blocker)
      const popup = window.open('about:blank', 'agentlink-auth', 'width=600,height=700,popup=yes');
      if (popup) {
        popup.location.href = res.data.authUrl;
        popupRef.current = popup;

        // Poll for popup close (auth completion is handled via SSE)
        const pollTimer = setInterval(() => {
          if (popup.closed) {
            clearInterval(pollTimer);
            setLoading(false);
            // Invalidate queries so UI refreshes
            queryClient.invalidateQueries({ queryKey: queryKeys.agentlinkStatus });
            queryClient.invalidateQueries({ queryKey: queryKeys.agentlinkMCPStatus });
            queryClient.invalidateQueries({ queryKey: queryKeys.agentlinkIntegrations });
            queryClient.invalidateQueries({ queryKey: queryKeys.agentlinkConnected });
          }
        }, 500);
      } else {
        throw new Error('Popup blocked. Please allow popups for this site.');
      }
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  }, [queryClient]);

  // Called when SSE 'agentlink:auth_completed' is received
  const onAuthCompleted = useCallback(() => {
    setLoading(false);
    // Close popup if still open
    if (popupRef.current && !popupRef.current.closed) {
      popupRef.current.close();
    }
    // Refresh all agentlink queries
    queryClient.invalidateQueries({ queryKey: queryKeys.agentlinkStatus });
    queryClient.invalidateQueries({ queryKey: queryKeys.agentlinkMCPStatus });
    queryClient.invalidateQueries({ queryKey: queryKeys.agentlinkIntegrations });
    queryClient.invalidateQueries({ queryKey: queryKeys.agentlinkConnected });
  }, [queryClient]);

  return { startAuth, loading, error, onAuthCompleted };
}
