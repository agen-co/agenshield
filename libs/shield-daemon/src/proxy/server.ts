/**
 * Per-run HTTP/CONNECT proxy server factory.
 *
 * Each seatbelt-wrapped process gets its own localhost proxy that enforces
 * URL policies on every outbound connection. The child process is configured
 * with HTTPS_PROXY=http://127.0.0.1:${port} and the seatbelt profile only
 * allows network-outbound to localhost, so all traffic must flow through here.
 */

import * as http from 'node:http';
import * as net from 'node:net';
import type { PolicyConfig } from '@agenshield/ipc';
import { checkUrlPolicy } from '../policy/url-matcher';

/**
 * Create an HTTP proxy server that enforces URL policies.
 *
 * Handles:
 * - CONNECT method (HTTPS tunneling): checks hostname against URL policies
 * - Plain HTTP requests: checks full URL against URL policies, forwards if allowed
 */
export function createPerRunProxy(
  urlPolicies: PolicyConfig[],
  onActivity: () => void,
  logger: (msg: string) => void
): http.Server {
  const server = http.createServer((req, res) => {
    onActivity();

    // Plain HTTP proxy request
    const url = req.url;
    if (!url) {
      res.writeHead(400);
      res.end('Bad request');
      return;
    }

    const allowed = checkUrlPolicy(urlPolicies, url);
    if (!allowed) {
      logger(`BLOCKED HTTP ${req.method} ${url}`);
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Blocked by AgenShield URL policy');
      return;
    }

    logger(`PROXY HTTP ${req.method} ${url}`);

    // Forward the request
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      res.writeHead(400);
      res.end('Invalid URL');
      return;
    }

    const proxyReq = http.request(
      {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 80,
        path: parsedUrl.pathname + parsedUrl.search,
        method: req.method,
        headers: req.headers,
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
        proxyRes.pipe(res);
      }
    );

    proxyReq.on('error', (err) => {
      logger(`PROXY HTTP error: ${err.message}`);
      if (!res.headersSent) {
        res.writeHead(502);
        res.end('Proxy error');
      }
    });

    req.pipe(proxyReq);
  });

  // CONNECT handler for HTTPS tunneling
  server.on('connect', (req: http.IncomingMessage, clientSocket: net.Socket, head: Buffer) => {
    onActivity();

    const target = req.url || '';
    const [hostname, portStr] = target.split(':');
    const port = parseInt(portStr) || 443;

    // Check URL policies for this hostname (use https:// since CONNECT is for TLS)
    const allowed = checkUrlPolicy(urlPolicies, `https://${hostname}`);
    if (!allowed) {
      logger(`BLOCKED CONNECT ${hostname}:${port}`);
      clientSocket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      clientSocket.destroy();
      return;
    }

    logger(`TUNNEL ${hostname}:${port}`);

    // DNS resolution + TCP tunnel happens inside the proxy (not the sandboxed child)
    const serverSocket = net.connect(port, hostname, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      serverSocket.write(head);
      serverSocket.pipe(clientSocket);
      clientSocket.pipe(serverSocket);
    });

    serverSocket.on('error', (err) => {
      logger(`TUNNEL error ${hostname}:${port}: ${err.message}`);
      clientSocket.destroy();
    });

    clientSocket.on('error', () => {
      serverSocket.destroy();
    });
  });

  return server;
}
