/**
 * Custom error types for the proxy library
 */

/**
 * Base error class for proxy errors
 */
export class ProxyError extends Error {
  public readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'ProxyError';
    this.code = code;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

/**
 * Error thrown when the proxy server fails to bind to a port
 */
export class ProxyBindError extends ProxyError {
  constructor(message: string = 'Failed to bind proxy server') {
    super(message, 'PROXY_BIND_FAILED');
    this.name = 'ProxyBindError';
  }
}

/**
 * Error thrown when the proxy pool has no capacity for new proxies
 */
export class ProxyPoolExhaustedError extends ProxyError {
  public readonly maxConcurrent: number;

  constructor(maxConcurrent: number) {
    super(
      `Proxy pool exhausted: max concurrent limit (${maxConcurrent}) reached`,
      'PROXY_POOL_EXHAUSTED',
    );
    this.name = 'ProxyPoolExhaustedError';
    this.maxConcurrent = maxConcurrent;
  }
}

/** Network error classification for CONNECT tunnel failures */
export type NetworkErrorType =
  | 'dns-resolution-failed'
  | 'connection-refused'
  | 'connection-timeout'
  | 'network-error';

export interface ClassifiedNetworkError {
  type: NetworkErrorType;
  userMessage: string;
}

/**
 * Classify a network error into a user-friendly category.
 * Used to send descriptive 502 responses instead of silently destroying the socket.
 */
export function classifyNetworkError(err: Error & { code?: string }): ClassifiedNetworkError {
  const code = err.code ?? '';

  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return {
      type: 'dns-resolution-failed',
      userMessage: `DNS resolution failed: ${err.message}`,
    };
  }
  if (code === 'ECONNREFUSED') {
    return {
      type: 'connection-refused',
      userMessage: `Connection refused: ${err.message}`,
    };
  }
  if (code === 'ETIMEDOUT' || code === 'ENETUNREACH' || code === 'EHOSTUNREACH') {
    return {
      type: 'connection-timeout',
      userMessage: `Connection timed out: ${err.message}`,
    };
  }

  return {
    type: 'network-error',
    userMessage: `Network error: ${err.message}`,
  };
}

/**
 * Error thrown when a request is blocked by URL policy
 */
export class PolicyBlockedError extends ProxyError {
  public readonly target: string;
  public readonly method: string;
  public readonly protocol: 'http' | 'https';

  constructor(options: { target: string; method: string; protocol: 'http' | 'https' }) {
    super(
      `Connection to ${options.target} blocked by URL policy (${options.method})`,
      'POLICY_BLOCKED',
    );
    this.name = 'PolicyBlockedError';
    this.target = options.target;
    this.method = options.method;
    this.protocol = options.protocol;
  }
}
