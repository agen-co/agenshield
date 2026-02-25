/**
 * Shared browser utilities
 *
 * Extracted from start.ts and setup.ts to avoid duplication.
 */

import { readAdminToken, fetchAdminToken, DAEMON_CONFIG } from './daemon.js';

/**
 * Open a URL in the default browser.
 * Non-fatal if the browser fails to open.
 */
export async function openBrowser(url: string): Promise<void> {
  try {
    const { exec } = await import('node:child_process');
    exec(`open "${url}"`);
  } catch {
    // Non-fatal — user can open manually
  }
}

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
