/**
 * Types for the proxy library
 */

import type { PolicyConfig } from '@agenshield/ipc';

/** TLS options for HTTPS forwarding */
export interface TlsOptions {
  /** Whether to reject self-signed or invalid certificates. Defaults to true. */
  rejectUnauthorized?: boolean;
  /** SSL termination config. When set, CONNECT tunnels use MITM to inspect HTTPS traffic. */
  sslTermination?: SslTerminationConfig;
}

/** SSL termination configuration for MITM HTTPS inspection */
export interface SslTerminationConfig {
  /** PEM root CA certificate */
  ca: string;
  /** PEM root CA private key */
  key: string;
  /** PEM root CA certificate (for node:tls API) */
  cert: string;
  /** Whether to cache generated per-host certificates. Defaults to true. */
  cacheCerts?: boolean;
}

/** Callbacks fired on proxy allow/block decisions */
export interface ProxyCallbacks {
  onBlock?: (method: string, target: string, protocol: 'http' | 'https') => void;
  onAllow?: (method: string, target: string, protocol: 'http' | 'https') => void;
}

/** Options for creating a per-run proxy server */
export interface CreateProxyOptions {
  /** Returns current active policies */
  getPolicies: () => PolicyConfig[];
  /** Returns the default action when no policy matches */
  getDefaultAction: () => 'allow' | 'deny';
  /** Called on every request to signal activity (resets idle timer) */
  onActivity: () => void;
  /** Logger function for proxy events */
  logger: (msg: string) => void;
  /** Called when a request is blocked by policy */
  onBlock?: (method: string, target: string, protocol: 'http' | 'https') => void;
  /** Called when a request is allowed */
  onAllow?: (method: string, target: string, protocol: 'http' | 'https') => void;
  /** TLS options for HTTPS forwarding */
  tls?: TlsOptions;
  /** Maximum number of concurrent connections. Defaults to 128. */
  maxConnections?: number;
  /** Upstream request timeout in milliseconds. Defaults to 30000. */
  upstreamTimeoutMs?: number;
  /** Maximum request body size in bytes. Defaults to 104857600 (100MB). */
  maxBodyBytes?: number;
}

/** Metadata for an active proxy instance in the pool */
export interface ProxyInstance {
  execId: string;
  command: string;
  port: number;
  server: import('node:http').Server;
  lastActivity: number;
  idleTimer: NodeJS.Timeout;
  /** Active TCP sockets for graceful shutdown drain */
  activeSockets: Set<import('node:net').Socket>;
}

/** Options for the proxy pool */
export interface ProxyPoolOptions {
  maxConcurrent?: number;
  idleTimeoutMs?: number;
  /** Timeout for graceful drain on releaseGracefully(). Defaults to 5000. */
  drainTimeoutMs?: number;
}

/** Decoupled hooks for pool events — replaces direct daemon imports */
export interface ProxyPoolHooks {
  /** Called when a request is blocked by policy */
  onBlock?: (execId: string, method: string, target: string, protocol: 'http' | 'https') => void;
  /** Called when a request is allowed */
  onAllow?: (execId: string, method: string, target: string, protocol: 'http' | 'https') => void;
  /** Called when a proxy is released */
  onRelease?: (execId: string) => void;
  /** Logger function. Defaults to console.log. */
  logger?: (msg: string) => void;
  /** TLS options passed through to proxy servers */
  tls?: TlsOptions;
}
