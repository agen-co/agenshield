/**
 * Unix Socket Server
 *
 * Primary IPC server for the broker daemon.
 * Handles JSON-RPC 2.0 requests over newline-delimited JSON.
 */

import * as net from 'node:net';
import * as fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import type {
  BrokerConfig,
  HandlerContext,
  JsonRpcRequest,
  JsonRpcResponse,
} from './types.js';
import type { PolicyEnforcer } from './policies/enforcer.js';
import type { AuditLogger } from './audit/logger.js';
import type { SecretVault } from './secrets/vault.js';
import type { SecretResolver } from './secrets/resolver.js';
import type { CommandAllowlist } from './policies/command-allowlist.js';
import * as handlers from './handlers/index.js';
import { forwardPolicyToDaemon } from './daemon-forward.js';

export interface UnixSocketServerOptions {
  config: BrokerConfig;
  policyEnforcer: PolicyEnforcer;
  auditLogger: AuditLogger;
  secretVault: SecretVault;
  secretResolver?: SecretResolver;
  commandAllowlist: CommandAllowlist;
}

export class UnixSocketServer {
  private server: net.Server | null = null;
  private config: BrokerConfig;
  private policyEnforcer: PolicyEnforcer;
  private auditLogger: AuditLogger;
  private secretVault: SecretVault;
  private secretResolver?: SecretResolver;
  private commandAllowlist: CommandAllowlist;
  private connections: Set<net.Socket> = new Set();

  constructor(options: UnixSocketServerOptions) {
    this.config = options.config;
    this.policyEnforcer = options.policyEnforcer;
    this.auditLogger = options.auditLogger;
    this.secretVault = options.secretVault;
    this.secretResolver = options.secretResolver;
    this.commandAllowlist = options.commandAllowlist;
  }

  /**
   * Start the Unix socket server
   */
  async start(): Promise<void> {
    // Remove existing socket file if it exists
    if (fs.existsSync(this.config.socketPath)) {
      fs.unlinkSync(this.config.socketPath);
    }

    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => {
        this.handleConnection(socket);
      });

      this.server.on('error', (error) => {
        reject(error);
      });

      this.server.listen(this.config.socketPath, () => {
        // Set socket permissions
        try {
          fs.chmodSync(this.config.socketPath, this.config.socketMode);
        } catch (error) {
          console.warn('Warning: Could not set socket permissions:', error);
        }

        resolve();
      });
    });
  }

  /**
   * Stop the Unix socket server
   */
  async stop(): Promise<void> {
    // Close all active connections
    for (const socket of this.connections) {
      socket.destroy();
    }
    this.connections.clear();

    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          // Clean up socket file
          if (fs.existsSync(this.config.socketPath)) {
            try {
              fs.unlinkSync(this.config.socketPath);
            } catch {
              // Ignore cleanup errors
            }
          }
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Handle a new client connection
   */
  private handleConnection(socket: net.Socket): void {
    this.connections.add(socket);

    let buffer = '';

    socket.on('data', async (data) => {
      buffer += data.toString();

      // Process complete JSON-RPC messages (newline-delimited)
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);

        if (line.trim()) {
          const response = await this.processRequest(line, socket);
          socket.write(JSON.stringify(response) + '\n');
        }
      }
    });

    socket.on('close', () => {
      this.connections.delete(socket);
    });

    socket.on('error', (error) => {
      console.error('Socket error:', error);
      this.connections.delete(socket);
    });
  }

  /**
   * Process a JSON-RPC request
   */
  private async processRequest(
    line: string,
    socket: net.Socket
  ): Promise<JsonRpcResponse> {
    const requestId = randomUUID();
    const startTime = Date.now();

    try {
      // Parse request
      let request: JsonRpcRequest;
      try {
        request = JSON.parse(line);
      } catch {
        return this.errorResponse(null, -32700, 'Parse error');
      }

      // Validate JSON-RPC structure
      if (request.jsonrpc !== '2.0' || !request.method || request.id === undefined) {
        return this.errorResponse(request.id, -32600, 'Invalid Request');
      }

      // Create handler context
      const context: HandlerContext = {
        requestId,
        channel: 'socket',
        timestamp: new Date(),
        config: this.config,
        // Socket credentials would be extracted here on supported platforms
      };

      // Check policy (skip for policy_check — the handler evaluates
      // the inner operation with proper params and daemon forwarding)
      const policyResult = request.method === 'policy_check'
        ? { allowed: true, policyId: undefined, reason: undefined }
        : await this.policyEnforcer.check(request.method, request.params, context);

      // If broker denies, try forwarding to daemon for user-defined policies
      let finalPolicy = policyResult;
      if (!policyResult.allowed) {
        const target = this.extractTarget(request);
        const daemonUrl = this.config.daemonUrl || 'http://127.0.0.1:5200';
        const override = await forwardPolicyToDaemon(request.method, target, daemonUrl);
        if (override) {
          finalPolicy = override;
        }
      }

      if (!finalPolicy.allowed) {
        await this.auditLogger.log({
          id: requestId,
          timestamp: new Date(),
          operation: request.method,
          channel: 'socket',
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
        secretVault: this.secretVault,
        secretResolver: this.secretResolver,
        commandAllowlist: this.commandAllowlist,
        daemonUrl: this.config.daemonUrl,
      });

      // Log success
      await this.auditLogger.log({
        id: requestId,
        timestamp: new Date(),
        operation: request.method,
        channel: 'socket',
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
      file_write: handlers.handleFileWrite,
      file_list: handlers.handleFileList,
      exec: handlers.handleExec,
      open_url: handlers.handleOpenUrl,
      secret_inject: handlers.handleSecretInject,
      ping: handlers.handlePing,
      skill_install: handlers.handleSkillInstall,
      skill_uninstall: handlers.handleSkillUninstall,
      policy_check: handlers.handlePolicyCheck,
      events_batch: handlers.handleEventsBatch,
      secrets_sync: handlers.handleSecretsSync,
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
