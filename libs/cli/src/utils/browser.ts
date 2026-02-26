/**
 * Shared browser utilities
 */

import { readAdminToken, fetchAdminToken, DAEMON_CONFIG } from './daemon.js';

/**
 * Build the dashboard URL with optional JWT token in hash.
 */
export function buildBrowserUrl(token: string | null): string {
  const base = `http://${DAEMON_CONFIG.DISPLAY_HOST}:${DAEMON_CONFIG.PORT}`;
  if (token) {
    return `${base}/#access_token=${token}`;
  }
  return base;
}

/**
 * Wait for the admin token to become available.
 * Tries the local file first (fast path for root), then falls back to the daemon API.
 */
export async function waitForAdminToken(maxWaitMs = 8000): Promise<string | null> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const fileToken = readAdminToken();
    if (fileToken) return fileToken;

    const apiToken = await fetchAdminToken();
    if (apiToken) return apiToken;

    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}
