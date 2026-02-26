/**
 * Authentication context provider
 *
 * JWT-based auth. Tokens arrive via URL hash (#access_token=<jwt>) set by
 * `agenshield start`, or restored from sessionStorage.
 *
 * Automatic token refresh is scheduled 2 minutes before expiry.
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { authApi } from '../api/auth';

interface AuthState {
  /** Whether initial auth check has completed */
  loaded: boolean;
  /** Whether the user is currently authenticated */
  authenticated: boolean;
  /** JWT token role */
  role: 'admin' | 'broker' | null;
  /** Current JWT token */
  token: string | null;
  /** Token expiration timestamp (ms) */
  expiresAt: number | null;
  /** Error message */
  error: string | null;
}

interface AuthContextValue extends AuthState {
  /** Refresh auth status from server */
  refreshStatus: () => Promise<void>;
  /** Store token and mark as authenticated (used by LoginGate after sudo login) */
  login: (token: string, expiresAt: number) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const SESSION_TOKEN_KEY = 'agenshield_jwt_token';
const SESSION_EXPIRES_KEY = 'agenshield_jwt_expires';

/**
 * Consume JWT from URL hash (#access_token=<jwt>) and remove it from the URL.
 */
function consumeHashToken(): { token: string; expiresAt: number } | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash;
  if (!hash) return null;

  const params = new URLSearchParams(hash.slice(1));
  const token = params.get('access_token');
  if (!token) return null;

  // Remove hash from URL without triggering navigation
  history.replaceState(null, '', window.location.pathname + window.location.search);

  // Decode JWT payload to get expiry (base64url)
  try {
    const payloadB64 = token.split('.')[1];
    if (!payloadB64) return null;
    const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')));
    const expiresAt = payload.exp ? payload.exp * 1000 : Date.now() + 30 * 60 * 1000;
    return { token, expiresAt };
  } catch {
    // If we can't decode, assume 30min TTL
    return { token, expiresAt: Date.now() + 30 * 60 * 1000 };
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>(() => {
    // Check URL hash first (highest priority)
    const hashToken = consumeHashToken();
    if (hashToken) {
      sessionStorage.setItem(SESSION_TOKEN_KEY, hashToken.token);
      sessionStorage.setItem(SESSION_EXPIRES_KEY, String(hashToken.expiresAt));
      return {
        loaded: true,
        authenticated: true,
        role: 'admin',
        token: hashToken.token,
        expiresAt: hashToken.expiresAt,
        error: null,
      };
    }

    // Restore from sessionStorage
    const savedToken = sessionStorage.getItem(SESSION_TOKEN_KEY);
    const savedExpires = sessionStorage.getItem(SESSION_EXPIRES_KEY);
    if (savedToken && savedExpires) {
      const expiresAt = parseInt(savedExpires, 10);
      if (Date.now() < expiresAt) {
        return {
          loaded: true,
          authenticated: true,
          role: 'admin',
          token: savedToken,
          expiresAt,
          error: null,
        };
      }
      // Expired — clear
      sessionStorage.removeItem(SESSION_TOKEN_KEY);
      sessionStorage.removeItem(SESSION_EXPIRES_KEY);
    }

    return {
      loaded: true,
      authenticated: false,
      role: null,
      token: null,
      expiresAt: null,
      error: null,
    };
  });

  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Listen for 401 responses to reset auth state
  useEffect(() => {
    const handleExpired = () => {
      setState((prev) => ({
        ...prev,
        authenticated: false,
        role: null,
        token: null,
        expiresAt: null,
      }));
      sessionStorage.removeItem(SESSION_TOKEN_KEY);
      sessionStorage.removeItem(SESSION_EXPIRES_KEY);
    };
    window.addEventListener('agenshield:auth-expired', handleExpired);
    return () => window.removeEventListener('agenshield:auth-expired', handleExpired);
  }, []);

  // Fetch auth status from server (validates current token)
  const refreshStatus = useCallback(async () => {
    try {
      const status = await authApi.getStatus();
      setState((prev) => ({
        ...prev,
        loaded: true,
        authenticated: status.authenticated,
        role: status.role ?? prev.role,
        expiresAt: status.expiresAt ?? prev.expiresAt,
        error: null,
      }));
    } catch {
      setState((prev) => ({
        ...prev,
        loaded: true,
        error: 'Failed to check auth status',
      }));
    }
  }, []);

  // Initial status check
  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  // Schedule token refresh before expiration
  useEffect(() => {
    if (state.token && state.expiresAt) {
      const timeUntilExpiry = state.expiresAt - Date.now();
      // Refresh 2 minutes before expiration
      const refreshIn = Math.max(timeUntilExpiry - 2 * 60 * 1000, 0);

      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }

      refreshTimerRef.current = setTimeout(async () => {
        try {
          const result = await authApi.refresh(state.token!);
          if (result.success && result.token && result.expiresAt) {
            setState((prev) => ({
              ...prev,
              token: result.token!,
              expiresAt: result.expiresAt!,
            }));
            sessionStorage.setItem(SESSION_TOKEN_KEY, result.token);
            sessionStorage.setItem(SESSION_EXPIRES_KEY, String(result.expiresAt));
          }
        } catch {
          // Token refresh failed — mark as unauthenticated
          setState((prev) => ({
            ...prev,
            authenticated: false,
            role: null,
            token: null,
            expiresAt: null,
          }));
          sessionStorage.removeItem(SESSION_TOKEN_KEY);
          sessionStorage.removeItem(SESSION_EXPIRES_KEY);
        }
      }, refreshIn);
    }

    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, [state.token, state.expiresAt]);

  const login = useCallback((token: string, expiresAt: number) => {
    sessionStorage.setItem(SESSION_TOKEN_KEY, token);
    sessionStorage.setItem(SESSION_EXPIRES_KEY, String(expiresAt));
    setState({
      loaded: true,
      authenticated: true,
      role: 'admin',
      token,
      expiresAt,
      error: null,
    });
  }, []);

  const contextValue: AuthContextValue = {
    ...state,
    refreshStatus,
    login,
  };

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
}

/**
 * Hook to access auth context
 */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
