/**
 * Log sanitizer — redacts sensitive tokens from URLs before logging.
 */

const SENSITIVE_PARAMS = ['token', 'access_token', 'refresh_token', 'code'];
const PARAM_PATTERN = new RegExp(
  `([?&](?:${SENSITIVE_PARAMS.join('|')})=)([^&\\s]+)`,
  'gi',
);

/**
 * Replace sensitive query parameters in a URL with `[REDACTED]`.
 *
 * Example:
 *   `/sse/events?token=eyJhbGci...` → `/sse/events?token=[REDACTED]`
 */
export function sanitizeLogUrl(url: string): string {
  return url.replace(PARAM_PATTERN, '$1[REDACTED]');
}
