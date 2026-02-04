/**
 * HTTP Request Handler
 *
 * Proxies HTTP requests through the broker.
 */

import type { HandlerContext, HandlerResult, HttpRequestParams, HttpRequestResult } from '../types.js';
import type { HandlerDependencies } from './types.js';

export async function handleHttpRequest(
  params: Record<string, unknown>,
  context: HandlerContext,
  deps: HandlerDependencies
): Promise<HandlerResult<HttpRequestResult>> {
  const startTime = Date.now();

  try {
    const {
      url,
      method = 'GET',
      headers = {},
      body,
      timeout = 30000,
      followRedirects = true,
    } = params as unknown as HttpRequestParams;

    if (!url) {
      return {
        success: false,
        error: { code: 1003, message: 'URL is required' },
      };
    }

    // Parse and validate URL
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return {
        success: false,
        error: { code: 1003, message: 'Invalid URL' },
      };
    }

    // Make the request
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method,
        headers: headers as Record<string, string>,
        body: body ? String(body) : undefined,
        signal: controller.signal,
        redirect: followRedirects ? 'follow' : 'manual',
      });

      clearTimeout(timeoutId);

      // Extract response headers
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      // Read response body
      const responseBody = await response.text();

      return {
        success: true,
        data: {
          status: response.status,
          statusText: response.statusText,
          headers: responseHeaders,
          body: responseBody,
        },
        audit: {
          duration: Date.now() - startTime,
          bytesTransferred: responseBody.length,
        },
      };
    } catch (error) {
      clearTimeout(timeoutId);

      if ((error as Error).name === 'AbortError') {
        return {
          success: false,
          error: { code: 1004, message: 'Request timeout' },
        };
      }

      return {
        success: false,
        error: { code: 1004, message: `Network error: ${(error as Error).message}` },
      };
    }
  } catch (error) {
    return {
      success: false,
      error: { code: 1004, message: `Handler error: ${(error as Error).message}` },
    };
  }
}
