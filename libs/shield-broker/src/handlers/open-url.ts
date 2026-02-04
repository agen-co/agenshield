/**
 * Open URL Handler
 *
 * Opens URLs in the default browser.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { HandlerContext, HandlerResult, OpenUrlParams, OpenUrlResult } from '../types.js';
import type { HandlerDependencies } from './types.js';

const execAsync = promisify(exec);

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

    // Open URL using macOS 'open' command
    const command = browser
      ? `open -a "${browser}" "${url}"`
      : `open "${url}"`;

    try {
      await execAsync(command, { timeout: 10000 });

      return {
        success: true,
        data: { opened: true },
        audit: {
          duration: Date.now() - startTime,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: 1006,
          message: `Failed to open URL: ${(error as Error).message}`,
        },
      };
    }
  } catch (error) {
    return {
      success: false,
      error: { code: 1006, message: `Handler error: ${(error as Error).message}` },
    };
  }
}
