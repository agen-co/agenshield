/**
 * Interceptor Configuration
 *
 * Configuration management for the interceptor.
 */

export interface InterceptorConfig {
  /** Unix socket path for broker communication */
  socketPath: string;

  /** HTTP fallback host */
  httpHost: string;

  /** HTTP fallback port */
  httpPort: number;

  /** Whether to fail open if broker is unavailable */
  failOpen: boolean;

  /** Log level */
  logLevel: 'debug' | 'info' | 'warn' | 'error';

  /** Enable fetch interception */
  interceptFetch: boolean;

  /** Enable http/https module interception */
  interceptHttp: boolean;

  /** Enable WebSocket interception */
  interceptWs: boolean;

  /** Enable fs module interception */
  interceptFs: boolean;

  /** Enable child_process interception */
  interceptExec: boolean;

  /** Request timeout in milliseconds */
  timeout: number;
}

/**
 * Create configuration from environment variables
 */
export function createConfig(overrides?: Partial<InterceptorConfig>): InterceptorConfig {
  const env = process.env;

  return {
    socketPath: env['AGENSHIELD_SOCKET'] || '/var/run/agenshield/agenshield.sock',
    httpHost: env['AGENSHIELD_HOST'] || 'localhost',
    httpPort: parseInt(env['AGENSHIELD_PORT'] || '5201', 10),
    failOpen: env['AGENSHIELD_FAIL_OPEN'] === 'true',
    logLevel: (env['AGENSHIELD_LOG_LEVEL'] as InterceptorConfig['logLevel']) || 'warn',
    interceptFetch: env['AGENSHIELD_INTERCEPT_FETCH'] !== 'false',
    interceptHttp: env['AGENSHIELD_INTERCEPT_HTTP'] !== 'false',
    interceptWs: env['AGENSHIELD_INTERCEPT_WS'] !== 'false',
    interceptFs: false,
    interceptExec: env['AGENSHIELD_INTERCEPT_EXEC'] !== 'false',
    timeout: parseInt(env['AGENSHIELD_TIMEOUT'] || '30000', 10),
    ...overrides,
  };
}

/**
 * Default configuration
 */
export const defaultConfig: InterceptorConfig = createConfig();
