/**
 * Per-run HTTP/CONNECT proxy server factory.
 *
 * Each seatbelt-wrapped process gets its own localhost proxy that enforces
 * URL policies on every outbound connection. The child process is configured
 * with HTTPS_PROXY=http://127.0.0.1:${port} and the seatbelt profile only
 * allows network-outbound to localhost, so all traffic must flow through here.
 *
 * Key fix over the original daemon implementation:
 * - Imports both `node:http` AND `node:https` for protocol-aware forwarding
 * - CONNECT handler always uses https:// for policy checks (tunnels are opaque)
 */

import * as http from 'node:http';
import * as https from 'node:https';
import * as net from 'node:net';
import * as tls from 'node:tls';
import { checkUrlPolicy } from '@agenshield/policies';
import type { CreateProxyOptions, SslTerminationConfig } from './types';
import { classifyNetworkError } from './errors';
import { CertificateCache, generateHostCertificate, createHostTlsContext } from './tls';

/** Headers that must not be forwarded between hops (RFC 2616 / RFC 7230) */
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'proxy-connection',
]);

/**
 * Strip hop-by-hop headers before forwarding to upstream.
 * Also removes any headers listed in the `connection` header value.
 */
export function sanitizeHeaders(
  headers: http.IncomingHttpHeaders,
): http.IncomingHttpHeaders {
  const result: http.IncomingHttpHeaders = {};

  // Collect additional headers to strip from the `connection` header
  const connectionValue = headers['connection'];
  const connectionTokens = new Set<string>();
  if (connectionValue) {
    for (const token of connectionValue.split(',')) {
      connectionTokens.add(token.trim().toLowerCase());
    }
  }

  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower) || connectionTokens.has(lower)) {
      continue;
    }
    result[key] = value;
  }

  return result;
}

/**
 * Create an HTTP proxy server that enforces URL policies.
 *
 * Handles:
 * - Plain HTTP/HTTPS requests: checks full URL against policies, forwards with protocol-aware client
 * - CONNECT method (tunneling): checks hostname against policies using https:// (tunnels are opaque)
 */
export function createPerRunProxy(options: CreateProxyOptions): http.Server {
  const {
    getPolicies,
    getDefaultAction,
    onActivity,
    logger,
    onBlock,
    onAllow,
    tls: tlsOpts,
    maxConnections = 128,
    upstreamTimeoutMs = 30_000,
    maxBodyBytes = 104_857_600,
  } = options;

  const sslTermination = tlsOpts?.sslTermination;
  const certCache = sslTermination ? new CertificateCache() : undefined;

  const server = http.createServer((req, res) => {
    onActivity();

    const url = req.url;
    if (!url) {
      res.writeHead(400);
      res.end('Bad request');
      return;
    }

    const allowed = checkUrlPolicy(getPolicies(), url, getDefaultAction());
    if (!allowed) {
      logger(`BLOCKED HTTP ${req.method} ${url}`);
      const protocol = url.startsWith('https://') ? 'https' : 'http';
      onBlock?.(req.method || 'GET', url, protocol);
      res.writeHead(403, { 'Content-Type': 'text/plain', 'X-Proxy-Error': 'blocked-by-policy' });
      res.end(`Connection to ${url} blocked by URL policy`);
      return;
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      res.writeHead(400);
      res.end('Invalid URL');
      return;
    }

    const isHttps = parsedUrl.protocol === 'https:';
    const protocol: 'http' | 'https' = isHttps ? 'https' : 'http';
    const defaultPort = isHttps ? 443 : 80;

    logger(`PROXY ${protocol.toUpperCase()} ${req.method} ${url}`);
    onAllow?.(req.method || 'GET', url, protocol);

    // Protocol-aware forwarding: use https.request for https:// URLs
    const requestFn = isHttps ? https.request : http.request;
    const requestOptions: http.RequestOptions & https.RequestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || defaultPort,
      path: parsedUrl.pathname + parsedUrl.search,
      method: req.method,
      headers: sanitizeHeaders(req.headers),
    };

    if (isHttps && tlsOpts) {
      requestOptions.rejectUnauthorized = tlsOpts.rejectUnauthorized;
    }

    const proxyReq = requestFn(requestOptions, (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res);
    });

    // Upstream timeout
    proxyReq.setTimeout(upstreamTimeoutMs, () => {
      logger(`UPSTREAM TIMEOUT ${url} after ${upstreamTimeoutMs}ms`);
      proxyReq.destroy();
      if (!res.headersSent) {
        res.writeHead(504, { 'Content-Type': 'text/plain' });
        res.end('Gateway Timeout');
      }
    });

    proxyReq.on('error', (err) => {
      logger(`PROXY ${protocol.toUpperCase()} error: ${err.message}`);
      if (!res.headersSent) {
        res.writeHead(502);
        res.end('Proxy error');
      }
    });

    // Body size limit — track incoming bytes and abort if exceeded
    let bytesReceived = 0;
    req.on('data', (chunk: Buffer) => {
      bytesReceived += chunk.length;
      if (bytesReceived > maxBodyBytes) {
        logger(`BODY LIMIT EXCEEDED ${url} (${bytesReceived} > ${maxBodyBytes})`);
        req.destroy();
        proxyReq.destroy();
        if (!res.headersSent) {
          res.writeHead(413, { 'Content-Type': 'text/plain' });
          res.end('Request body too large');
        }
      }
    });

    req.pipe(proxyReq);
  });

  // Connection limits
  server.maxConnections = maxConnections;
  server.headersTimeout = 60_000;
  server.requestTimeout = 30_000;

  // CONNECT handler for tunneling — always use https:// for policy checks.
  // CONNECT tunnels are opaque TCP pipes; the proxy never sees the inner protocol
  // (could be TLS, MongoDB, Redis, WebSocket, etc.). Using https:// avoids
  // falsely triggering "block non-localhost plain HTTP" logic.
  server.on('connect', (req: http.IncomingMessage, clientSocket: net.Socket, head: Buffer) => {
    onActivity();

    const target = req.url || '';
    const [hostname, portStr] = target.split(':');
    const port = parseInt(portStr) || 443;

    const policyUrl = `https://${hostname}`;

    const allowed = checkUrlPolicy(getPolicies(), policyUrl, getDefaultAction());
    if (!allowed) {
      logger(`BLOCKED CONNECT ${hostname}:${port}`);
      onBlock?.('CONNECT', `${hostname}:${port}`, 'https');
      clientSocket.write(
        'HTTP/1.1 403 Forbidden\r\n' +
        'Content-Type: text/plain\r\n' +
        'X-Proxy-Error: blocked-by-policy\r\n' +
        '\r\n' +
        `Connection to ${hostname} blocked by URL policy`,
      );
      clientSocket.destroy();
      return;
    }

    // SSL termination: MITM flow for full URL inspection
    if (sslTermination && certCache) {
      handleSslTerminatedConnect(
        hostname, port, clientSocket, head,
        sslTermination, certCache,
        getPolicies, getDefaultAction,
        logger, onBlock, onAllow,
        upstreamTimeoutMs, tlsOpts,
      );
      return;
    }

    // Default: opaque TCP pipe (no MITM)
    logger(`TUNNEL ${hostname}:${port}`);
    onAllow?.('CONNECT', `https://${hostname}:${port}`, 'https');

    const serverSocket = net.connect(port, hostname, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      serverSocket.write(head);
      serverSocket.pipe(clientSocket);
      clientSocket.pipe(serverSocket);
    });

    // Upstream timeout on tunnel
    serverSocket.setTimeout(upstreamTimeoutMs, () => {
      logger(`TUNNEL TIMEOUT ${hostname}:${port} after ${upstreamTimeoutMs}ms`);
      serverSocket.destroy();
      clientSocket.destroy();
    });

    serverSocket.on('error', (err) => {
      const errorType = classifyNetworkError(err as Error & { code?: string });
      logger(`TUNNEL ${errorType.type} ${hostname}:${port}: ${err.message}`);
      clientSocket.write(
        'HTTP/1.1 502 Bad Gateway\r\n' +
        `X-Proxy-Error: ${errorType.type}\r\n` +
        'Content-Type: text/plain\r\n\r\n' +
        errorType.userMessage,
      );
      clientSocket.destroy();
    });

    clientSocket.on('error', () => {
      serverSocket.destroy();
    });
  });

  return server;
}

/**
 * Handle a CONNECT tunnel with SSL termination (MITM).
 * Decrypts client TLS, inspects full URLs, enforces policy, forwards to upstream.
 */
function handleSslTerminatedConnect(
  hostname: string,
  port: number,
  clientSocket: net.Socket,
  head: Buffer,
  sslConfig: SslTerminationConfig,
  certCache: CertificateCache,
  getPolicies: () => import('@agenshield/ipc').PolicyConfig[],
  getDefaultAction: () => 'allow' | 'deny',
  logger: (msg: string) => void,
  onBlock: ((method: string, target: string, protocol: 'http' | 'https') => void) | undefined,
  onAllow: ((method: string, target: string, protocol: 'http' | 'https') => void) | undefined,
  upstreamTimeoutMs: number,
  tlsOpts: { rejectUnauthorized?: boolean } | undefined,
): void {
  logger(`SSL-TERMINATE ${hostname}:${port}`);

  // Generate or retrieve cached certificate for this host
  let hostCert: { cert: string; key: string };
  const shouldCache = sslConfig.cacheCerts !== false;

  if (shouldCache) {
    const cached = certCache.get(hostname);
    if (cached) {
      hostCert = cached;
    } else {
      try {
        hostCert = generateHostCertificate(hostname, sslConfig.cert, sslConfig.key);
        certCache.set(hostname, hostCert);
      } catch (err) {
        logger(`SSL-TERMINATE cert generation failed for ${hostname}: ${(err as Error).message}`);
        clientSocket.write(
          'HTTP/1.1 502 Bad Gateway\r\n' +
          'X-Proxy-Error: ssl-termination-failed\r\n' +
          'Content-Type: text/plain\r\n\r\n' +
          `SSL termination failed for ${hostname}`,
        );
        clientSocket.destroy();
        return;
      }
    }
  } else {
    try {
      hostCert = generateHostCertificate(hostname, sslConfig.cert, sslConfig.key);
    } catch (err) {
      logger(`SSL-TERMINATE cert generation failed for ${hostname}: ${(err as Error).message}`);
      clientSocket.write(
        'HTTP/1.1 502 Bad Gateway\r\n' +
        'X-Proxy-Error: ssl-termination-failed\r\n' +
        'Content-Type: text/plain\r\n\r\n' +
        `SSL termination failed for ${hostname}`,
      );
      clientSocket.destroy();
      return;
    }
  }

  // Send 200 to client — we'll handle TLS from here
  clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');

  // Create TLS server socket wrapping the client connection
  const tlsContext = createHostTlsContext(hostCert, sslConfig.ca);
  const tlsSocket = new tls.TLSSocket(clientSocket, {
    isServer: true,
    secureContext: tlsContext,
  });

  if (head.length > 0) {
    tlsSocket.unshift(head);
  }

  // Parse decrypted HTTP requests from the TLS socket
  tlsSocket.on('data', (data: Buffer) => {
    // Simple HTTP request line parsing from the decrypted stream
    const str = data.toString('utf-8');
    const firstLine = str.split('\r\n')[0];
    const parts = firstLine.split(' ');

    if (parts.length < 2) return;

    const method = parts[0];
    const path = parts[1];
    const fullUrl = `https://${hostname}${path}`;

    const urlAllowed = checkUrlPolicy(getPolicies(), fullUrl, getDefaultAction());
    if (!urlAllowed) {
      logger(`BLOCKED SSL-TERMINATE ${method} ${fullUrl}`);
      onBlock?.(method, fullUrl, 'https');
      const response =
        'HTTP/1.1 403 Forbidden\r\n' +
        'Content-Type: text/plain\r\n' +
        'X-Proxy-Error: blocked-by-policy\r\n' +
        'Connection: close\r\n' +
        '\r\n' +
        `Connection to ${fullUrl} blocked by URL policy`;
      tlsSocket.write(response);
      tlsSocket.end();
      return;
    }

    logger(`SSL-TERMINATE PROXY ${method} ${fullUrl}`);
    onAllow?.(method, fullUrl, 'https');

    // Forward the decrypted request to the upstream HTTPS server
    const upstreamOptions: https.RequestOptions = {
      hostname,
      port,
      path,
      method,
      headers: sanitizeHeaders(parseHeaders(str)),
      rejectUnauthorized: tlsOpts?.rejectUnauthorized,
    };

    const upstreamReq = https.request(upstreamOptions, (upstreamRes) => {
      // Build response line
      let responseHead = `HTTP/1.1 ${upstreamRes.statusCode} ${upstreamRes.statusMessage}\r\n`;
      for (const [key, value] of Object.entries(upstreamRes.headers)) {
        if (value !== undefined) {
          if (Array.isArray(value)) {
            for (const v of value) {
              responseHead += `${key}: ${v}\r\n`;
            }
          } else {
            responseHead += `${key}: ${value}\r\n`;
          }
        }
      }
      responseHead += '\r\n';
      tlsSocket.write(responseHead);
      upstreamRes.pipe(tlsSocket);
    });

    upstreamReq.setTimeout(upstreamTimeoutMs, () => {
      logger(`SSL-TERMINATE UPSTREAM TIMEOUT ${fullUrl}`);
      upstreamReq.destroy();
      const response =
        'HTTP/1.1 504 Gateway Timeout\r\n' +
        'Content-Type: text/plain\r\n' +
        'Connection: close\r\n' +
        '\r\n' +
        'Gateway Timeout';
      tlsSocket.write(response);
      tlsSocket.end();
    });

    upstreamReq.on('error', (err) => {
      logger(`SSL-TERMINATE UPSTREAM error for ${fullUrl}: ${err.message}`);
      if (!tlsSocket.destroyed) {
        const response =
          'HTTP/1.1 502 Bad Gateway\r\n' +
          'Content-Type: text/plain\r\n' +
          'Connection: close\r\n' +
          '\r\n' +
          'Proxy error';
        tlsSocket.write(response);
        tlsSocket.end();
      }
    });

    // Forward the request body (everything after headers)
    const headerEnd = str.indexOf('\r\n\r\n');
    if (headerEnd !== -1) {
      const bodyStart = headerEnd + 4;
      if (bodyStart < data.length) {
        upstreamReq.write(data.slice(bodyStart));
      }
    }
    upstreamReq.end();
  });

  tlsSocket.on('error', (err) => {
    logger(`SSL-TERMINATE TLS error for ${hostname}: ${err.message}`);
    clientSocket.destroy();
  });

  clientSocket.on('error', () => {
    tlsSocket.destroy();
  });
}

/** Parse headers from an HTTP request string (after the first line) */
function parseHeaders(requestStr: string): http.IncomingHttpHeaders {
  const headers: http.IncomingHttpHeaders = {};
  const lines = requestStr.split('\r\n');
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === '') break;
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim().toLowerCase();
      const value = line.slice(colonIdx + 1).trim();
      headers[key] = value;
    }
  }
  return headers;
}
