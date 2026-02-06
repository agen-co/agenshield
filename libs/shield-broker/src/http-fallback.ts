/**
 * HTTP Fallback Server
 *
 * Restricted HTTP server for operations that can't use Unix sockets.
 * Only allows a subset of operations for security.
 */

import * as http from 'node:http';
import { randomUUID } from 'node:crypto';
import type {
  BrokerConfig,
  HandlerContext,
  JsonRpcRequest,
  JsonRpcResponse,
} from './types.js';
import type { PolicyEnforcer } from './policies/enforcer.js';
import type { AuditLogger } from './audit/logger.js';
import * as handlers from './handlers/index.js';

/** Operations allowed over HTTP fallback */
const HTTP_ALLOWED_OPERATIONS = new Set([
  'http_request',
  'file_read',
  'file_list',
  'open_url',
  'ping',
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
}

export class HttpFallbackServer {
  private server: http.Server | null = null;
  private config: BrokerConfig;
  private policyEnforcer: PolicyEnforcer;
  private auditLogger: AuditLogger;

  constructor(options: HttpFallbackServerOptions) {
    this.config = options.config;
    this.policyEnforcer = options.policyEnforcer;
    this.auditLogger = options.auditLogger;
  }

  /**
   * Start the HTTP fallback server
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
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

      // Check policy
      const policyResult = await this.policyEnforcer.check(
        request.method as any,
        request.params,
        context
      );

      if (!policyResult.allowed) {
        await this.auditLogger.log({
          id: requestId,
          timestamp: new Date(),
          operation: request.method as any,
          channel: 'http',
          allowed: false,
          policyId: policyResult.policyId,
          target: this.extractTarget(request),
          result: 'denied',
          errorMessage: policyResult.reason,
          durationMs: Date.now() - startTime,
        });

        return this.errorResponse(request.id, 1001, policyResult.reason || 'Policy denied');
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
      });

      // Log success
      await this.auditLogger.log({
        id: requestId,
        timestamp: new Date(),
        operation: request.method as any,
        channel: 'http',
        allowed: true,
        policyId: policyResult.policyId,
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
