/**
 * @agenshield/proxy — Protocol-aware HTTP/HTTPS proxy with URL policy enforcement
 *
 * @packageDocumentation
 */

// Server
export { createPerRunProxy, sanitizeHeaders } from './server';

// Pool
export { ProxyPool } from './pool';

// TLS
export { CertificateCache, generateHostCertificate, createHostTlsContext } from './tls';
export type { GeneratedCert } from './tls';

// Types
export type {
  TlsOptions,
  SslTerminationConfig,
  ProxyCallbacks,
  CreateProxyOptions,
  ProxyInstance,
  ProxyPoolOptions,
  ProxyPoolHooks,
} from './types';

// Errors
export {
  ProxyError,
  ProxyBindError,
  ProxyPoolExhaustedError,
  PolicyBlockedError,
  UpstreamTimeoutError,
  SslTerminationError,
  classifyNetworkError,
  type NetworkErrorType,
  type ClassifiedNetworkError,
} from './errors';
