/**
 * CONNECT Tunnel Utility
 *
 * Establishes an HTTP CONNECT tunnel through the proxy for HTTPS connections.
 * The proxy server already handles CONNECT correctly (policy check + TCP pipe),
 * so the client just needs to initiate the tunnel handshake.
 */

import * as fs from 'node:fs';
import * as http from 'node:http';
import * as tls from 'node:tls';
import * as net from 'node:net';
import { debugLog } from '../debug-log.js';
import { PolicyDeniedError } from '../errors.js';

// ── System CA certificate loading (defense-in-depth) ──────────────

const CA_BUNDLE_PATHS = ['/etc/ssl/cert.pem', '/etc/ssl/certs/ca-certificates.crt'];
let _systemCaCerts: string[] | null = null;

/**
 * Lazy-load system CA certificates from the PEM bundle.
 * Only activates when NODE_EXTRA_CA_CERTS is NOT already set.
 * Caches the result for the process lifetime.
 */
function getSystemCaCerts(): string[] | undefined {
  if (process.env['NODE_EXTRA_CA_CERTS']) return undefined;

  if (_systemCaCerts !== null) return _systemCaCerts.length > 0 ? _systemCaCerts : undefined;

  for (const bundlePath of CA_BUNDLE_PATHS) {
    try {
      const content = fs.readFileSync(bundlePath, 'utf-8');
      const certs = content.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
      if (certs && certs.length > 0) {
        _systemCaCerts = certs;
        debugLog(`connect-tunnel: loaded ${certs.length} CA certs from ${bundlePath}`);
        return _systemCaCerts;
      }
    } catch {
      // Not found or unreadable — try next
    }
  }

  _systemCaCerts = [];
  return undefined;
}

// Capture raw http.request before any interception can modify it
const _rawHttpRequest = http.request;

export interface ConnectTunnelOptions {
  /** Proxy hostname (e.g., '127.0.0.1') */
  proxyHostname: string;
  /** Proxy port */
  proxyPort: number;
  /** Target hostname for the CONNECT request */
  targetHostname: string;
  /** Target port (defaults to 443) */
  targetPort?: number;
  /** Timeout in ms for the CONNECT handshake (defaults to 30000) */
  timeoutMs?: number;
}

export interface TunnelResult {
  /** Raw TCP socket to the proxy */
  socket: net.Socket;
  /** TLS-wrapped socket for making HTTPS requests */
  tlsSocket: tls.TLSSocket;
}

/**
 * Establish a CONNECT tunnel through the proxy and wrap it with TLS.
 *
 * 1. Sends `CONNECT hostname:port` to the proxy via raw http.request
 * 2. On 200: wraps the socket with tls.connect({ socket, servername })
 * 3. On 403: rejects with PolicyDeniedError
 * 4. On error/timeout: rejects with descriptive error
 */
export function establishConnectTunnel(options: ConnectTunnelOptions): Promise<TunnelResult> {
  const {
    proxyHostname,
    proxyPort,
    targetHostname,
    targetPort = 443,
    timeoutMs = 30_000,
  } = options;

  return new Promise<TunnelResult>((resolve, reject) => {
    const connectTarget = `${targetHostname}:${targetPort}`;
    debugLog(`connect-tunnel: CONNECT ${connectTarget} via ${proxyHostname}:${proxyPort}`);

    const req = _rawHttpRequest({
      hostname: proxyHostname,
      port: proxyPort,
      method: 'CONNECT',
      path: connectTarget,
    });

    // Timeout for the CONNECT handshake
    const timer = setTimeout(() => {
      req.destroy(new Error(`CONNECT tunnel timeout after ${timeoutMs}ms to ${connectTarget}`));
    }, timeoutMs);

    req.on('connect', (_res, socket, head) => {
      clearTimeout(timer);

      const statusCode = _res.statusCode ?? 0;

      if (statusCode === 403) {
        socket.destroy();
        reject(new PolicyDeniedError(
          `Connection to ${targetHostname} blocked by URL policy`,
          { operation: 'http_request', target: `https://${targetHostname}` },
        ));
        return;
      }

      if (statusCode !== 200) {
        socket.destroy();
        reject(new Error(`CONNECT tunnel failed with status ${statusCode} to ${connectTarget}`));
        return;
      }

      debugLog(`connect-tunnel: tunnel established to ${connectTarget}`);

      // Wrap the raw socket with TLS
      const tlsSocket = tls.connect({
        socket,
        servername: targetHostname,
        ca: getSystemCaCerts(),
      });

      // Push any buffered head data into the TLS socket
      if (head.length > 0) {
        socket.unshift(head);
      }

      tlsSocket.on('error', (err) => {
        debugLog(`connect-tunnel: TLS error ${connectTarget}: ${err.message}`);
        reject(err);
      });

      tlsSocket.once('secureConnect', () => {
        debugLog(`connect-tunnel: TLS handshake complete for ${connectTarget}`);
        resolve({ socket, tlsSocket });
      });
    });

    req.on('error', (err) => {
      clearTimeout(timer);
      debugLog(`connect-tunnel: error ${connectTarget}: ${err.message}`);
      reject(err);
    });

    req.end();
  });
}
