/**
 * OAuth hook for AgentLink authentication
 *
 * Calls auth/start to get the authorization URL, then navigates
 * the current page directly (no popup needed).
 */

import { useState, useCallback } from 'react';
import { api } from '../../api/client';

export function useAgentLinkOAuth() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startAuth = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await api.agentlink.startAuth();
      if (!res.success || !res.data?.authUrl) {
        // Already connected or no auth needed
        if (res.data?.message) {
          setLoading(false);
          return;
        }
        throw new Error(res.error || 'Failed to start auth flow');
      }

      // Navigate the current page to the auth URL
      window.location.href = res.data.authUrl;
      // Don't reset loading — page is navigating away
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  }, []);

  return { startAuth, loading, error };
}
