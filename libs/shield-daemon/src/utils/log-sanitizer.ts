/**
 * Log sanitizer — redacts sensitive tokens, secrets, and PII from log content.
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

// ── Full-content sanitization for log downloads ──────────────────

/** Known sensitive env var names (case-insensitive match) */
const SENSITIVE_ENV_NAMES = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_ACCESS_KEY_ID',
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'NPM_TOKEN',
  'CLAUDE_API_KEY',
];

/** Pattern for known sensitive env var assignments: NAME=value or NAME="value" */
const SENSITIVE_ENV_EXACT = new RegExp(
  `((?:${SENSITIVE_ENV_NAMES.join('|')})\\s*=\\s*)("[^"]*"|'[^']*'|\\S+)`,
  'gi',
);

/** Pattern for generic env vars ending with _TOKEN, _SECRET, _PASSWORD, _KEY with suspicious values */
const SENSITIVE_ENV_GENERIC = /(\b\w+(?:_TOKEN|_SECRET|_PASSWORD|_KEY|_APIKEY)\s*=\s*)("[^"]*"|'[^']*'|\S+)/gi;

/** JWT-like patterns (eyJ followed by base64 characters) */
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]{10,})?/g;

/** Bearer token headers */
const BEARER_PATTERN = /(Bearer\s+)\S+/gi;

/** API key patterns (sk-, pk-, key-, etc. followed by alphanumeric) */
const API_KEY_PATTERN = /\b(sk-|pk-|key-|api-)[A-Za-z0-9_-]{20,}\b/g;

/**
 * Sanitize full log content for safe download/sharing.
 *
 * Redacts:
 * - Known sensitive env var values (ANTHROPIC_API_KEY, etc.)
 * - Generic *_TOKEN, *_SECRET, *_PASSWORD, *_KEY env vars
 * - JWT tokens (eyJ...)
 * - Bearer tokens
 * - API key patterns (sk-*, pk-*)
 * - Home directory paths containing real usernames
 * - URL query parameters with sensitive names
 */
export function sanitizeLogContent(text: string, hostUsername?: string): string {
  let result = text;

  // Redact known sensitive env vars
  result = result.replace(SENSITIVE_ENV_EXACT, '$1[REDACTED]');

  // Redact generic sensitive env vars
  result = result.replace(SENSITIVE_ENV_GENERIC, '$1[REDACTED]');

  // Redact JWT tokens
  result = result.replace(JWT_PATTERN, '[REDACTED_JWT]');

  // Redact Bearer tokens
  result = result.replace(BEARER_PATTERN, '$1[REDACTED]');

  // Redact API key patterns
  result = result.replace(API_KEY_PATTERN, '[REDACTED_KEY]');

  // Redact sensitive URL params
  result = result.replace(PARAM_PATTERN, '$1[REDACTED]');

  // Redact home directory paths containing the real username
  if (hostUsername) {
    const homePattern = new RegExp(`/Users/${escapeRegex(hostUsername)}`, 'g');
    result = result.replace(homePattern, '/Users/[REDACTED]');
  }

  return result;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
