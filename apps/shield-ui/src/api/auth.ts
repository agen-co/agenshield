/**
 * Auth API client for AgenShield daemon
 */

import type {
  AuthStatusResponse,
  UnlockRequest,
  UnlockResponse,
  LockResponse,
  SetupPasscodeRequest,
  SetupPasscodeResponse,
  ChangePasscodeRequest,
  ChangePasscodeResponse,
} from '@agenshield/ipc';

const BASE_URL = '/api';

async function authRequest<T>(endpoint: string, options?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${endpoint}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
  } catch {
    throw new Error('Unable to connect to daemon');
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const error = new Error(data.error || `API Error: ${res.status} ${res.statusText}`);
    (error as Error & { status: number; data: unknown }).status = res.status;
    (error as Error & { status: number; data: unknown }).data = data;
    throw error;
  }

  return data as T;
}

export const authApi = {
  /**
   * Check auth status (is passcode set, protection enabled, etc.)
   */
  getStatus: () => authRequest<AuthStatusResponse>('/auth/status'),

  /**
   * Authenticate with passcode
   */
  unlock: (passcode: string) =>
    authRequest<UnlockResponse>('/auth/unlock', {
      method: 'POST',
      body: JSON.stringify({ passcode } satisfies UnlockRequest),
    }),

  /**
   * Invalidate session
   */
  lock: (token: string) =>
    authRequest<LockResponse>('/auth/lock', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),

  /**
   * Set initial passcode
   */
  setup: (passcode: string, enableProtection = true) =>
    authRequest<SetupPasscodeResponse>('/auth/setup', {
      method: 'POST',
      body: JSON.stringify({ passcode, enableProtection } satisfies SetupPasscodeRequest),
    }),

  /**
   * Change existing passcode
   */
  change: (oldPasscode: string, newPasscode: string) =>
    authRequest<ChangePasscodeResponse>('/auth/change', {
      method: 'POST',
      body: JSON.stringify({ oldPasscode, newPasscode } satisfies ChangePasscodeRequest),
    }),

  /**
   * Refresh session token
   */
  refresh: (token: string) =>
    authRequest<{ success: boolean; token?: string; expiresAt?: number }>('/auth/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    }),

  /**
   * Enable passcode protection
   */
  enableProtection: (token: string) =>
    authRequest<{ success: boolean }>('/auth/enable', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    }),

  /**
   * Disable passcode protection
   */
  disableProtection: (token: string) =>
    authRequest<{ success: boolean }>('/auth/disable', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    }),

  /**
   * Toggle anonymous read-only access
   */
  setAnonymousReadOnly: (token: string, allowed: boolean) =>
    authRequest<{ success: boolean; allowAnonymousReadOnly: boolean }>('/auth/anonymous-readonly', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ allowed }),
    }),
};
