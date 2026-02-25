/**
 * Auth API client for AgenShield daemon
 *
 * JWT-based authentication — tokens are issued by the daemon (via CLI start
 * or sudo login) and refreshed automatically before expiry.
 */

import type {
  AuthStatusResponse,
  SudoLoginRequest,
  SudoLoginResponse,
  RefreshResponse,
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
   * Check auth status (is the current request authenticated, role, expiry)
   */
  getStatus: () => authRequest<AuthStatusResponse>('/auth/status'),

  /**
   * Login with macOS sudo credentials
   */
  sudoLogin: (username: string, password: string) =>
    authRequest<SudoLoginResponse>('/auth/sudo-login', {
      method: 'POST',
      body: JSON.stringify({ username, password } satisfies SudoLoginRequest),
    }),

  /**
   * Refresh JWT token
   */
  refresh: (token: string) =>
    authRequest<RefreshResponse>('/auth/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({}),
    }),
};
