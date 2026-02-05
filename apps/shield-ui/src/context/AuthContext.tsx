/**
 * Authentication context provider
 *
 * Manages auth state, token storage, and automatic token refresh.
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import type { AuthStatusResponse } from '@agenshield/ipc';
import { authApi } from '../api/auth';

interface AuthState {
  /** Whether auth status has been loaded */
  loaded: boolean;
  /** Whether a passcode has been set */
  passcodeSet: boolean;
  /** Whether protection is enabled */
  protectionEnabled: boolean;
  /** Whether anonymous read-only access is allowed (default: true) */
  allowAnonymousReadOnly: boolean;
  /** Whether the user is currently authenticated */
  authenticated: boolean;
  /** Current session token */
  token: string | null;
  /** Token expiration timestamp */
  expiresAt: number | null;
  /** Whether account is locked out */
  lockedOut: boolean;
  /** When lockout expires */
  lockedUntil: string | null;
  /** Error message */
  error: string | null;
}

interface AuthContextValue extends AuthState {
  /** Unlock with passcode */
  unlock: (passcode: string) => Promise<{ success: boolean; error?: string; remainingAttempts?: number }>;
  /** Lock (invalidate session) */
  lock: () => Promise<void>;
  /** Setup initial passcode */
  setup: (passcode: string) => Promise<{ success: boolean; error?: string }>;
  /** Change passcode */
  changePasscode: (oldPasscode: string, newPasscode: string) => Promise<{ success: boolean; error?: string }>;
  /** Refresh auth status from server */
  refreshStatus: () => Promise<void>;
  /** Check if we need authentication for protected actions */
  requiresAuth: boolean;
  /** Whether the UI should be fully blocked until authenticated */
  requiresFullAuth: boolean;
  /** Whether current session is read-only (not authenticated but anonymous access allowed) */
  isReadOnly: boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const SESSION_TOKEN_KEY = 'agenshield_session_token';
const SESSION_EXPIRES_KEY = 'agenshield_session_expires';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    loaded: false,
    passcodeSet: false,
    protectionEnabled: false,
    allowAnonymousReadOnly: true,
    authenticated: false,
    token: null,
    expiresAt: null,
    lockedOut: false,
    lockedUntil: null,
    error: null,
  });

  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Restore token from sessionStorage
  useEffect(() => {
    const savedToken = sessionStorage.getItem(SESSION_TOKEN_KEY);
    const savedExpires = sessionStorage.getItem(SESSION_EXPIRES_KEY);

    if (savedToken && savedExpires) {
      const expiresAt = parseInt(savedExpires, 10);
      if (Date.now() < expiresAt) {
        setState((prev) => ({
          ...prev,
          token: savedToken,
          expiresAt,
          authenticated: true,
        }));
      } else {
        // Token expired, clear it
        sessionStorage.removeItem(SESSION_TOKEN_KEY);
        sessionStorage.removeItem(SESSION_EXPIRES_KEY);
      }
    }
  }, []);

  // Fetch auth status from server
  const refreshStatus = useCallback(async () => {
    try {
      const status: AuthStatusResponse = await authApi.getStatus();
      setState((prev) => ({
        ...prev,
        loaded: true,
        passcodeSet: status.passcodeSet,
        protectionEnabled: status.protectionEnabled,
        allowAnonymousReadOnly: status.allowAnonymousReadOnly ?? true,
        lockedOut: status.lockedOut,
        lockedUntil: status.lockedUntil || null,
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
          // Token refresh failed, mark as unauthenticated
          setState((prev) => ({
            ...prev,
            authenticated: false,
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

  const unlock = useCallback(async (passcode: string) => {
    try {
      const result = await authApi.unlock(passcode);

      if (result.success && result.token) {
        setState((prev) => ({
          ...prev,
          authenticated: true,
          token: result.token!,
          expiresAt: result.expiresAt!,
          error: null,
          lockedOut: false,
        }));
        sessionStorage.setItem(SESSION_TOKEN_KEY, result.token);
        sessionStorage.setItem(SESSION_EXPIRES_KEY, String(result.expiresAt));
        return { success: true };
      }

      return {
        success: false,
        error: result.error || 'Authentication failed',
        remainingAttempts: result.remainingAttempts,
      };
    } catch (err) {
      const error = err as Error & { data?: { remainingAttempts?: number; error?: string } };
      const errorMsg = error.data?.error || error.message || 'Authentication failed';

      // Check if locked out
      if ((err as Error & { status?: number }).status === 429) {
        setState((prev) => ({ ...prev, lockedOut: true }));
        await refreshStatus();
      }

      return {
        success: false,
        error: errorMsg,
        remainingAttempts: error.data?.remainingAttempts,
      };
    }
  }, [refreshStatus]);

  const lock = useCallback(async () => {
    if (state.token) {
      try {
        await authApi.lock(state.token);
      } catch {
        // Ignore errors when locking
      }
    }

    setState((prev) => ({
      ...prev,
      authenticated: false,
      token: null,
      expiresAt: null,
    }));
    sessionStorage.removeItem(SESSION_TOKEN_KEY);
    sessionStorage.removeItem(SESSION_EXPIRES_KEY);
  }, [state.token]);

  const setup = useCallback(async (passcode: string) => {
    try {
      const result = await authApi.setup(passcode);
      if (result.success) {
        await refreshStatus();
        // Automatically unlock after setup
        return unlock(passcode);
      }
      return { success: false, error: result.error || 'Setup failed' };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }, [refreshStatus, unlock]);

  const changePasscode = useCallback(async (oldPasscode: string, newPasscode: string) => {
    try {
      const result = await authApi.change(oldPasscode, newPasscode);
      if (result.success) {
        // Session is cleared server-side, re-authenticate with new passcode
        setState((prev) => ({
          ...prev,
          authenticated: false,
          token: null,
          expiresAt: null,
        }));
        sessionStorage.removeItem(SESSION_TOKEN_KEY);
        sessionStorage.removeItem(SESSION_EXPIRES_KEY);
        return { success: true };
      }
      return { success: false, error: result.error || 'Change failed' };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }, []);

  const requiresAuth = state.protectionEnabled && state.passcodeSet && !state.authenticated;
  // Full auth required: protection enabled, no anonymous read-only, and not authenticated
  const requiresFullAuth = requiresAuth && !state.allowAnonymousReadOnly;
  // Read-only: protection enabled, authenticated is false, but anonymous read-only is allowed
  const isReadOnly = state.protectionEnabled && state.passcodeSet && !state.authenticated && state.allowAnonymousReadOnly;

  const contextValue: AuthContextValue = {
    ...state,
    unlock,
    lock,
    setup,
    changePasscode,
    refreshStatus,
    requiresAuth,
    requiresFullAuth,
    isReadOnly,
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
