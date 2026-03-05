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
import { checkUrlPolicy } from '@agenshield/policies';
import type { CreateProxyOptions } from './types';
import { classifyNetworkError } from './errors';

/**
 * Create an HTTP proxy server that enforces URL policies.
 *
 * Handles:
 * - Plain HTTP/HTTPS requests: checks full URL against policies, forwards with protocol-aware client
 * - CONNECT method (tunneling): checks hostname against policies using https:// (tunnels are opaque)
 */
export function createPerRunProxy(options: CreateProxyOptions): http.Server {
  const { getPolicies, getDefaultAction, onActivity, logger, onBlock, onAllow, tls } = options;

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
      headers: req.headers,
    };

    if (isHttps && tls) {
      requestOptions.rejectUnauthorized = tls.rejectUnauthorized;
    }

    const proxyReq = requestFn(requestOptions, (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      logger(`PROXY ${protocol.toUpperCase()} error: ${err.message}`);
      if (!res.headersSent) {
        res.writeHead(502);
        res.end('Proxy error');
      }
    });

    req.pipe(proxyReq);
  });

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

    logger(`TUNNEL ${hostname}:${port}`);
    onAllow?.('CONNECT', `https://${hostname}:${port}`, 'https');

    const serverSocket = net.connect(port, hostname, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      serverSocket.write(head);
      serverSocket.pipe(clientSocket);
      clientSocket.pipe(serverSocket);
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
