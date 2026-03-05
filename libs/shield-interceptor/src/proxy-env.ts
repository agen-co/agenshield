/**
 * Proxy Environment Detection
 *
 * Reads HTTP_PROXY/HTTPS_PROXY env vars and provides proxy routing
 * configuration. When a proxy is configured, interceptors route traffic
 * through it instead of making direct connections (the proxy handles
 * policy enforcement).
 */

import { debugLog } from './debug-log.js';

export interface ProxyConfig {
  /** Whether proxy routing is active */
  enabled: boolean;
  /** Parsed proxy hostname (e.g., '127.0.0.1') */
  hostname: string;
  /** Parsed proxy port */
  port: number;
  /** Raw proxy URL (e.g., 'http://127.0.0.1:54321') */
  url: string;
  /** NO_PROXY patterns (comma-separated hostnames/IPs) */
  noProxy: string[];
}

const DISABLED: ProxyConfig = { enabled: false, hostname: '', port: 0, url: '', noProxy: [] };

/**
 * Read proxy configuration from environment variables.
 * Returns enabled: false if no proxy is configured.
 */
export function getProxyConfig(): ProxyConfig {
  const httpsProxy = process.env['HTTPS_PROXY'] || process.env['https_proxy'];
  const httpProxy = process.env['HTTP_PROXY'] || process.env['http_proxy'];
  const proxyUrl = httpsProxy || httpProxy;

  if (!proxyUrl) return DISABLED;

  try {
    const parsed = new URL(proxyUrl);
    const noProxyRaw = process.env['NO_PROXY'] || process.env['no_proxy'] || '';
    const noProxy = noProxyRaw.split(',').map(s => s.trim()).filter(Boolean);

    debugLog(`proxy-env: detected proxy at ${parsed.hostname}:${parsed.port}`);

    return {
      enabled: true,
      hostname: parsed.hostname,
      port: parseInt(parsed.port) || 80,
      url: proxyUrl,
      noProxy,
    };
  } catch {
    debugLog(`proxy-env: failed to parse proxy URL: ${proxyUrl}`);
    return DISABLED;
  }
}

/**
 * Check if a URL should bypass the proxy based on NO_PROXY rules.
 *
 * Supports:
 * - Exact hostname match: `example.com`
 * - Suffix match with leading dot: `.example.com` matches `foo.example.com`
 * - Implicit suffix match: `example.com` matches `sub.example.com`
 * - Wildcard `*` bypasses everything
 */
export function shouldBypassProxy(url: string, noProxy: string[]): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;

    for (const pattern of noProxy) {
      if (pattern === '*') return true;
      if (hostname === pattern) return true;
      if (pattern.startsWith('.') && hostname.endsWith(pattern)) return true;
      if (hostname.endsWith(`.${pattern}`)) return true;
    }
    return false;
  } catch {
    return false;
  }
}
