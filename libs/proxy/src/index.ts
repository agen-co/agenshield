/**
 * @agenshield/proxy — Protocol-aware HTTP/HTTPS proxy with URL policy enforcement
 *
 * @packageDocumentation
 */

// Server
export { createPerRunProxy } from './server';

// Pool
export { ProxyPool } from './pool';

// Types
export type {
  TlsOptions,
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
  classifyNetworkError,
  type NetworkErrorType,
  type ClassifiedNetworkError,
} from './errors';
