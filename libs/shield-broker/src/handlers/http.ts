/**
 * HTTP Request Handler
 *
 * Proxies HTTP requests through the broker using node:http/node:https.
 * Uses the same transport stack as handleHttpProxy() (net.connect / http.request)
 * which works reliably in LaunchDaemon context, unlike fetch() (undici).
 */

import * as http from 'node:http';
import * as https from 'node:https';
import type { HandlerContext, HandlerResult, HttpRequestParams, HttpRequestResult } from '../types.js';
import type { HandlerDependencies } from './types.js';

const MAX_REDIRECTS = 10;

/**
 * Perform an HTTP(S) request using node:http/node:https.
 * Handles redirects manually when followRedirects is true.
 */
function doRequest(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string | undefined,
  timeout: number,
  followRedirects: boolean,
  redirectCount = 0
): Promise<{ status: number; statusText: string; headers: Record<string, string>; body: string }> {
  return new Promise((resolve, reject) => {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      reject(new Error('Invalid URL'));
      return;
    }

    const isHttps = parsedUrl.protocol === 'https:';
    const transport = isHttps ? https : http;
    const defaultPort = isHttps ? 443 : 80;

    const options: http.RequestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || defaultPort,
      path: parsedUrl.pathname + parsedUrl.search,
      method,
      headers,
      timeout,
    };

    const req = transport.request(options, (res) => {
      // Handle redirects
      const statusCode = res.statusCode ?? 502;
      if (
        followRedirects &&
        [301, 302, 303, 307, 308].includes(statusCode) &&
        res.headers.location
      ) {
        if (redirectCount >= MAX_REDIRECTS) {
          reject(new Error('Too many redirects'));
          return;
        }

        // 303 always becomes GET; 301/302 become GET for non-GET/HEAD
        const redirectMethod =
          statusCode === 303 || (statusCode <= 302 && method !== 'GET' && method !== 'HEAD')
            ? 'GET'
            : method;
        const redirectBody = redirectMethod === 'GET' ? undefined : body;

        // Resolve relative redirects
        const redirectUrl = new URL(res.headers.location, url).toString();

        // Drain this response before following
        res.resume();

        doRequest(redirectUrl, redirectMethod, headers, redirectBody, timeout, true, redirectCount + 1)
          .then(resolve)
          .catch(reject);
        return;
      }

      // Collect response body
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => {
        const responseBody = Buffer.concat(chunks).toString('utf-8');

        // Extract response headers
        const responseHeaders: Record<string, string> = {};
        for (const [key, value] of Object.entries(res.headers)) {
          if (value !== undefined) {
            responseHeaders[key] = Array.isArray(value) ? value.join(', ') : value;
          }
        }

        resolve({
          status: statusCode,
          statusText: res.statusMessage ?? '',
          headers: responseHeaders,
          body: responseBody,
        });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(Object.assign(new Error('Request timeout'), { name: 'AbortError' }));
    });

    if (body) {
      req.write(body);
    }
    req.end();
  });
}

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

    // Validate URL
    try {
      new URL(url);
    } catch {
      return {
        success: false,
        error: { code: 1003, message: 'Invalid URL' },
      };
    }

    try {
      const result = await doRequest(
        url,
        method,
        headers as Record<string, string>,
        body ? String(body) : undefined,
        timeout,
        followRedirects
      );

      return {
        success: true,
        data: {
          status: result.status,
          statusText: result.statusText,
          headers: result.headers,
          body: result.body,
        },
        audit: {
          duration: Date.now() - startTime,
          bytesTransferred: result.body.length,
        },
      };
    } catch (error) {
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
