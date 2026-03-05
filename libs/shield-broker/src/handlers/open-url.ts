/**
 * Open URL Handler
 *
 * Forwards open_url requests to the daemon, which runs as the host user
 * and can actually launch browsers. The daemon also checks policy and
 * emits activity events visible in shield-ui.
 *
 * Sandboxed agent users cannot exec `open` (macOS launchd domain restriction).
 */

import type { HandlerContext, HandlerResult, OpenUrlParams, OpenUrlResult } from '../types.js';
import type { HandlerDependencies } from './types.js';
import { forwardOpenUrlToDaemon } from '../daemon-forward.js';

export async function handleOpenUrl(
  params: Record<string, unknown>,
  context: HandlerContext,
  deps: HandlerDependencies
): Promise<HandlerResult<OpenUrlResult>> {
  const startTime = Date.now();

  try {
    const { url, browser } = params as unknown as OpenUrlParams;

    if (!url) {
      return {
        success: false,
        error: { code: 1003, message: 'URL is required' },
      };
    }

    // Validate URL
    try {
      new URL(url);
    } catch {
      return {
        success: false,
        error: { code: 1003, message: 'Invalid URL' },
      };
    }

    // Only allow http/https URLs
    const parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return {
        success: false,
        error: { code: 1003, message: 'Only http/https URLs are allowed' },
      };
    }

    // Forward to daemon — it runs as the host user and can open browsers.
    // The daemon also evaluates user-defined policies and emits events for shield-ui.
    const daemonUrl = deps.daemonUrl || 'http://127.0.0.1:5200';
    const result = await forwardOpenUrlToDaemon(url, browser, daemonUrl, deps.brokerAuth);

    if (result && result.opened) {
      return {
        success: true,
        data: { opened: true },
        audit: {
          duration: Date.now() - startTime,
        },
      };
    }

    return {
      success: false,
      error: {
        code: 1006,
        message: result?.reason || 'Failed to open URL: daemon could not open URL',
      },
    };
  } catch (error) {
    return {
      success: false,
      error: { code: 1006, message: `Handler error: ${(error as Error).message}` },
    };
  }
}
