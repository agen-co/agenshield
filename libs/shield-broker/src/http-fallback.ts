/**
 * HTTP Fallback Server
 *
 * Restricted HTTP server for operations that can't use Unix sockets.
 * Only allows a subset of operations for security.
 */

import * as http from 'node:http';
import * as net from 'node:net';
import { randomUUID } from 'node:crypto';
import type {
  BrokerConfig,
  HandlerContext,
  JsonRpcRequest,
  JsonRpcResponse,
} from './types.js';
import type { PolicyEnforcer } from './policies/enforcer.js';
import type { AuditLogger } from './audit/logger.js';
import type { CommandAllowlist } from './policies/command-allowlist.js';
import type { BrokerAuth } from './handlers/types.js';
import * as handlers from './handlers/index.js';
import { forwardPolicyToDaemon } from './daemon-forward.js';

/** Operations allowed over HTTP fallback */
const HTTP_ALLOWED_OPERATIONS = new Set([
  'http_request',
  'file_read',
  'file_list',
  'open_url',
  'ping',
  'policy_check',
  'events_batch',
]);

/** Operations denied over HTTP fallback */
const HTTP_DENIED_OPERATIONS = new Set([
  'exec',
  'file_write',
  'secret_inject',
]);

export interface HttpFallbackServerOptions {
  config: BrokerConfig;
  policyEnforcer: PolicyEnforcer;
  auditLogger: AuditLogger;
  commandAllowlist: CommandAllowlist;
  brokerAuth?: BrokerAuth;
}

export class HttpFallbackServer {
  private server: http.Server | null = null;
  private activeTunnels = new Set<net.Socket>();
  private config: BrokerConfig;
  private policyEnforcer: PolicyEnforcer;
  private auditLogger: AuditLogger;
  private commandAllowlist: CommandAllowlist;
  private brokerAuth?: BrokerAuth;

  constructor(options: HttpFallbackServerOptions) {
    this.config = options.config;
    this.policyEnforcer = options.policyEnforcer;
    this.auditLogger = options.auditLogger;
    this.commandAllowlist = options.commandAllowlist;
    this.brokerAuth = options.brokerAuth;
  }

  /**
   * Start the HTTP fallback server
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.on('connect', (req, clientSocket, head) => {
        this.handleConnect(req, clientSocket as net.Socket, head);
      });

      this.server.on('error', (error) => {
        reject(error);
      });

      // Normalize localhost to 127.0.0.1 to avoid IPv6 binding issues on macOS
      // (localhost resolves to ::1 on macOS, causing conflicts with daemon)
      const listenHost = this.config.httpHost === 'localhost' ? '127.0.0.1' : this.config.httpHost;

      this.server.listen(this.config.httpPort, listenHost, () => {
        resolve();
      });
    });
  }

  /**
   * Stop the HTTP fallback server
   */
  async stop(): Promise<void> {
    // Destroy all active CONNECT tunnels
    for (const socket of this.activeTunnels) {
      socket.destroy();
    }
    this.activeTunnels.clear();

    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Handle an HTTP request
   */
  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    // Handle plain HTTP proxy requests (absolute URLs from HTTP_PROXY clients)
    if (req.url?.startsWith('http://')) {
      this.handleHttpProxy(req, res);
      return;
    }

    // Only allow POST to /rpc
    if (req.method !== 'POST' || req.url !== '/rpc') {
      // Handle health check
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', version: '0.1.0' }));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    // Verify request is from localhost
    const remoteAddr = req.socket.remoteAddress;
    if (!this.isLocalhost(remoteAddr)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Access denied: localhost only' }));
      return;
    }

    // Read request body
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      // Limit body size
      if (body.length > 10 * 1024 * 1024) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Request too large' }));
        return;
      }
    }

    // Process JSON-RPC request
    const response = await this.processRequest(body);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
  }

  /**
   * Check if address is localhost
   */
  private isLocalhost(address: string | undefined): boolean {
    if (!address) return false;
    return (
      address === '127.0.0.1' ||
      address === '::1' ||
      address === '::ffff:127.0.0.1' ||
      address === 'localhost'
    );
  }

  /**
   * Handle CONNECT requests for HTTPS tunneling.
   *
   * When HTTPS_PROXY is set, clients send CONNECT hostname:port to establish
   * a TLS tunnel. We check the hostname against URL policies, then pipe
   * the sockets bidirectionally.
   */
  private async handleConnect(
    req: http.IncomingMessage,
    clientSocket: net.Socket,
    head: Buffer
  ): Promise<void> {
    const requestId = randomUUID();
    const startTime = Date.now();

    // Verify request is from localhost
    const remoteAddr = req.socket.remoteAddress;
    if (!this.isLocalhost(remoteAddr)) {
      clientSocket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      clientSocket.destroy();
      return;
    }

    const target = req.url || '';
    const [hostname, portStr] = target.split(':');
    const port = parseInt(portStr) || 443;

    if (!hostname) {
      clientSocket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      clientSocket.destroy();
      return;
    }

    // Check URL policy (CONNECT is for TLS, so use https://)
    const policyUrl = `https://${hostname}`;
    const context: HandlerContext = {
      requestId,
      channel: 'http',
      timestamp: new Date(),
      config: this.config,
    };

    let policyResult = await this.policyEnforcer.check(
      'http_request',
      { url: policyUrl },
      context
    );

    // If broker denies, try forwarding to daemon for user-defined policies
    if (!policyResult.allowed) {
      const daemonUrl = this.config.daemonUrl || 'http://127.0.0.1:5200';
      const override = await forwardPolicyToDaemon(
        'http_request',
        policyUrl,
        daemonUrl,
        undefined,
        this.brokerAuth
      );
      if (override) {
        policyResult = override;
      }
    }

    if (!policyResult.allowed) {
      await this.auditLogger.log({
        id: requestId,
        timestamp: new Date(),
        operation: 'http_request' as any,
        channel: 'http',
        allowed: false,
        policyId: policyResult.policyId,
        target: `${hostname}:${port}`,
        result: 'denied',
        errorMessage: policyResult.reason,
        durationMs: Date.now() - startTime,
        metadata: { protocol: 'https', method: 'CONNECT' },
      });

      clientSocket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      clientSocket.destroy();
      return;
    }

    // Establish tunnel
    const serverSocket = net.connect(port, hostname, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      serverSocket.write(head);
      serverSocket.pipe(clientSocket);
      clientSocket.pipe(serverSocket);
    });

    // Track for graceful shutdown
    this.activeTunnels.add(clientSocket);
    this.activeTunnels.add(serverSocket);

    const cleanup = () => {
      this.activeTunnels.delete(clientSocket);
      this.activeTunnels.delete(serverSocket);
    };

    clientSocket.on('close', cleanup);
    serverSocket.on('close', cleanup);

    serverSocket.on('error', (err) => {
      this.auditLogger.log({
        id: requestId,
        timestamp: new Date(),
        operation: 'http_request' as any,
        channel: 'http',
        allowed: true,
        target: `${hostname}:${port}`,
        result: 'error',
        errorMessage: `TUNNEL error: ${err.message}`,
        durationMs: Date.now() - startTime,
        metadata: { protocol: 'https', method: 'CONNECT' },
      });
      clientSocket.destroy();
    });

    clientSocket.on('error', () => {
      serverSocket.destroy();
    });

    await this.auditLogger.log({
      id: requestId,
      timestamp: new Date(),
      operation: 'http_request' as any,
      channel: 'http',
      allowed: true,
      policyId: policyResult.policyId,
      target: `${hostname}:${port}`,
      result: 'success',
      durationMs: Date.now() - startTime,
      metadata: { protocol: 'https', method: 'CONNECT' },
    });
  }

  /**
   * Handle plain HTTP proxy requests (absolute-URL requests).
   *
   * When HTTP_PROXY is set, clients send requests like `GET http://host/path`
   * through the proxy. We check the URL against policies and forward if allowed.
   */
  private async handleHttpProxy(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const requestId = randomUUID();
    const startTime = Date.now();
    const url = req.url!;

    // Verify request is from localhost
    const remoteAddr = req.socket.remoteAddress;
    if (!this.isLocalhost(remoteAddr)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Access denied: localhost only');
      return;
    }

    // Check URL policy
    const context: HandlerContext = {
      requestId,
      channel: 'http',
      timestamp: new Date(),
      config: this.config,
    };

    let policyResult = await this.policyEnforcer.check(
      'http_request',
      { url },
      context
    );

    if (!policyResult.allowed) {
      const daemonUrl = this.config.daemonUrl || 'http://127.0.0.1:5200';
      const override = await forwardPolicyToDaemon(
        'http_request',
        url,
        daemonUrl,
        undefined,
        this.brokerAuth
      );
      if (override) {
        policyResult = override;
      }
    }

    if (!policyResult.allowed) {
      await this.auditLogger.log({
        id: requestId,
        timestamp: new Date(),
        operation: 'http_request' as any,
        channel: 'http',
        allowed: false,
        policyId: policyResult.policyId,
        target: url,
        result: 'denied',
        errorMessage: policyResult.reason,
        durationMs: Date.now() - startTime,
        metadata: { protocol: 'http', method: req.method },
      });

      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Blocked by AgenShield URL policy');
      return;
    }

    // Parse and forward the request
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Invalid URL');
      return;
    }

    // Strip proxy-specific headers before forwarding
    const headers = { ...req.headers };
    delete headers['proxy-connection'];
    delete headers['proxy-authorization'];

    const proxyReq = http.request(
      {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 80,
        path: parsedUrl.pathname + parsedUrl.search,
        method: req.method,
        headers,
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
        proxyRes.pipe(res);
      }
    );

    proxyReq.on('error', (err) => {
      this.auditLogger.log({
        id: requestId,
        timestamp: new Date(),
        operation: 'http_request' as any,
        channel: 'http',
        allowed: true,
        target: url,
        result: 'error',
        errorMessage: `HTTP proxy error: ${err.message}`,
        durationMs: Date.now() - startTime,
        metadata: { protocol: 'http', method: req.method },
      });

      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end('Proxy error');
      }
    });

    req.pipe(proxyReq);

    await this.auditLogger.log({
      id: requestId,
      timestamp: new Date(),
      operation: 'http_request' as any,
      channel: 'http',
      allowed: true,
      policyId: policyResult.policyId,
      target: url,
      result: 'success',
      durationMs: Date.now() - startTime,
      metadata: { protocol: 'http', method: req.method },
    });
  }

  /**
   * Process a JSON-RPC request
   */
  private async processRequest(body: string): Promise<JsonRpcResponse> {
    const requestId = randomUUID();
    const startTime = Date.now();

    try {
      // Parse request
      let request: JsonRpcRequest;
      try {
        request = JSON.parse(body);
      } catch {
        return this.errorResponse(null, -32700, 'Parse error');
      }

      // Validate JSON-RPC structure
      if (request.jsonrpc !== '2.0' || !request.method || request.id === undefined) {
        return this.errorResponse(request.id, -32600, 'Invalid Request');
      }

      // Check if operation is allowed over HTTP
      if (HTTP_DENIED_OPERATIONS.has(request.method)) {
        await this.auditLogger.log({
          id: requestId,
          timestamp: new Date(),
          operation: request.method as any,
          channel: 'http',
          allowed: false,
          target: this.extractTarget(request),
          result: 'denied',
          errorMessage: 'Operation not allowed over HTTP fallback',
          durationMs: Date.now() - startTime,
        });

        return this.errorResponse(
          request.id,
          1008,
          `Operation '${request.method}' not allowed over HTTP. Use Unix socket.`
        );
      }

      if (!HTTP_ALLOWED_OPERATIONS.has(request.method)) {
        return this.errorResponse(request.id, -32601, 'Method not found');
      }

      // Create handler context
      const context: HandlerContext = {
        requestId,
        channel: 'http',
        timestamp: new Date(),
        config: this.config,
      };

      // Check policy (skip for policy_check — the handler evaluates
      // the inner operation with proper params and daemon forwarding)
      const policyResult = request.method === 'policy_check'
        ? { allowed: true, policyId: undefined, reason: undefined }
        : await this.policyEnforcer.check(request.method as any, request.params, context);

      // If broker denies, try forwarding to daemon for user-defined policies
      let finalPolicy = policyResult;
      if (!policyResult.allowed) {
        const target = this.extractTarget(request);
        const daemonUrl = this.config.daemonUrl || 'http://127.0.0.1:5200';
        const override = await forwardPolicyToDaemon(request.method, target, daemonUrl, undefined, this.brokerAuth);
        if (override) {
          finalPolicy = override;
        }
      }

      if (!finalPolicy.allowed) {
        await this.auditLogger.log({
          id: requestId,
          timestamp: new Date(),
          operation: request.method as any,
          channel: 'http',
          allowed: false,
          policyId: finalPolicy.policyId,
          target: this.extractTarget(request),
          result: 'denied',
          errorMessage: finalPolicy.reason,
          durationMs: Date.now() - startTime,
        });

        return this.errorResponse(request.id, 1001, finalPolicy.reason || 'Policy denied');
      }

      // Execute handler
      const handler = this.getHandler(request.method);
      if (!handler) {
        return this.errorResponse(request.id, -32601, 'Method not found');
      }

      const result = await handler(request.params, context, {
        policyEnforcer: this.policyEnforcer,
        auditLogger: this.auditLogger,
        secretVault: null as any, // Not available over HTTP
        commandAllowlist: this.commandAllowlist,
        daemonUrl: this.config.daemonUrl,
        brokerAuth: this.brokerAuth,
      });

      // Log success
      await this.auditLogger.log({
        id: requestId,
        timestamp: new Date(),
        operation: request.method as any,
        channel: 'http',
        allowed: true,
        policyId: finalPolicy.policyId,
        target: this.extractTarget(request),
        result: result.success ? 'success' : 'error',
        errorMessage: result.error?.message,
        durationMs: Date.now() - startTime,
        metadata: result.audit,
      });

      if (result.success) {
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: result.data,
        };
      } else {
        return this.errorResponse(
          request.id,
          result.error?.code || -32000,
          result.error?.message || 'Unknown error'
        );
      }
    } catch (error) {
      console.error('Request processing error:', error);
      return this.errorResponse(null, -32603, 'Internal error');
    }
  }

  /**
   * Get the handler for an operation type
   */
  private getHandler(method: string): ((
    params: Record<string, unknown>,
    context: HandlerContext,
    deps: any
  ) => Promise<{ success: boolean; data?: unknown; error?: { code: number; message: string }; audit?: Record<string, unknown> }>) | undefined {
    const handlerMap: Record<string, (
      params: Record<string, unknown>,
      context: HandlerContext,
      deps: any
    ) => Promise<{ success: boolean; data?: unknown; error?: { code: number; message: string }; audit?: Record<string, unknown> }>> = {
      http_request: handlers.handleHttpRequest,
      file_read: handlers.handleFileRead,
      file_list: handlers.handleFileList,
      open_url: handlers.handleOpenUrl,
      ping: handlers.handlePing,
      policy_check: handlers.handlePolicyCheck,
      events_batch: handlers.handleEventsBatch,
    };

    return handlerMap[method];
  }

  /**
   * Extract target from request for audit logging
   */
  private extractTarget(request: JsonRpcRequest): string {
    const params = request.params || {};
    return (
      (params['url'] as string) ||
      (params['path'] as string) ||
      (params['command'] as string) ||
      (params['name'] as string) ||
      request.method
    );
  }

  /**
   * Create an error response
   */
  private errorResponse(
    id: string | number | null,
    code: number,
    message: string
  ): JsonRpcResponse {
    return {
      jsonrpc: '2.0',
      id: id ?? 0,
      error: { code, message },
    };
  }
}
