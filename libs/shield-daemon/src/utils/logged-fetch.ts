/**
 * Logged fetch utility — wraps fetch() with console logging and SSE event emission.
 * Sanitizes sensitive parameters from URLs and bodies before logging.
 */

import { emitApiOutbound } from '../events/emitter';

const SENSITIVE_URL_PARAMS = ['client_secret', 'code_verifier', 'refresh_token', 'access_token'];
const SENSITIVE_BODY_FIELDS = ['access_token', 'refresh_token', 'client_secret', 'code_verifier', 'id_token'];
const MAX_BODY_LOG = 2000;
const MAX_CONSOLE_BODY = 500;

/**
 * Sanitize a URL by redacting sensitive query parameters
 */
function sanitizeUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const param of SENSITIVE_URL_PARAMS) {
      if (u.searchParams.has(param)) {
        u.searchParams.set(param, '[REDACTED]');
      }
    }
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * Sanitize a string body by redacting sensitive fields
 */
function sanitizeBody(body: string | undefined): string | undefined {
  if (!body) return undefined;

  let sanitized = body;
  for (const field of SENSITIVE_BODY_FIELDS) {
    // Handle JSON: "field": "value" or "field":"value"
    sanitized = sanitized.replace(
      new RegExp(`("${field}"\\s*:\\s*)"[^"]*"`, 'g'),
      '$1"[REDACTED]"',
    );
    // Handle form-encoded: field=value
    sanitized = sanitized.replace(
      new RegExp(`(${field}=)[^&]*`, 'g'),
      '$1[REDACTED]',
    );
  }

  return sanitized.slice(0, MAX_BODY_LOG);
}

/**
 * Extract body string from RequestInit for logging
 */
function extractRequestBody(init: RequestInit): string | undefined {
  if (!init.body) return undefined;
  if (typeof init.body === 'string') return init.body;
  if (init.body instanceof URLSearchParams) return init.body.toString();
  return undefined;
}

/**
 * Logged fetch — wraps native fetch with request/response logging and SSE emission.
 *
 * @param url - The URL to fetch
 * @param init - Standard RequestInit options
 * @param context - A label for the call context (e.g. 'agenco:token-refresh')
 */
export async function loggedFetch(url: string, init: RequestInit, context: string): Promise<Response> {
  const method = (init.method || 'GET').toUpperCase();
  const safeUrl = sanitizeUrl(url);
  const start = Date.now();

  console.log(`\x1b[36m->\x1b[0m ${method} ${safeUrl} \x1b[2m(${context})\x1b[0m`);

  try {
    const response = await fetch(url, init);
    const duration = Date.now() - start;
    const status = response.status;
    const color = status >= 400 ? '\x1b[31m' : status >= 300 ? '\x1b[33m' : '\x1b[32m';

    console.log(`${color}<-\x1b[0m ${status} ${safeUrl} \x1b[2m${duration}ms\x1b[0m`);

    // Read response body for logging (clone to not consume the original)
    let responseBodyStr: string | undefined;
    if (!response.ok) {
      try {
        const cloned = response.clone();
        responseBodyStr = await cloned.text();
        const truncated = responseBodyStr.slice(0, MAX_CONSOLE_BODY);
        console.log(`\x1b[2m   Response body: ${truncated}${responseBodyStr.length > MAX_CONSOLE_BODY ? '...' : ''}\x1b[0m`);
      } catch {
        // ignore body read failures
      }
    } else {
      // For successful responses, still capture body for SSE event
      try {
        const cloned = response.clone();
        responseBodyStr = await cloned.text();
      } catch {
        // ignore
      }
    }

    // Emit SSE event
    emitApiOutbound({
      context,
      url: safeUrl,
      method,
      statusCode: status,
      duration,
      requestBody: sanitizeBody(extractRequestBody(init)),
      responseBody: sanitizeBody(responseBodyStr),
      success: response.ok,
    });

    return response;
  } catch (error) {
    const duration = Date.now() - start;
    console.log(`\x1b[31m<- ERROR\x1b[0m ${safeUrl} \x1b[2m${duration}ms — ${(error as Error).message}\x1b[0m`);

    emitApiOutbound({
      context,
      url: safeUrl,
      method,
      statusCode: 0,
      duration,
      requestBody: sanitizeBody(extractRequestBody(init)),
      responseBody: (error as Error).message,
      success: false,
    });

    throw error;
  }
}
