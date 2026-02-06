/**
 * Broker Client
 *
 * Client for communicating with the broker daemon via Unix socket or HTTP.
 */

import * as net from 'node:net';
import { randomUUID } from 'node:crypto';
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  HttpRequestParams,
  HttpRequestResult,
  FileReadParams,
  FileReadResult,
  FileWriteParams,
  FileWriteResult,
  FileListParams,
  FileListResult,
  ExecParams,
  ExecResult,
  OpenUrlParams,
  OpenUrlResult,
  SecretInjectParams,
  SecretInjectResult,
  PingResult,
  SkillInstallParams,
  SkillInstallResult,
  SkillUninstallParams,
  SkillUninstallResult,
} from '../types.js';

export interface BrokerClientOptions {
  /** Unix socket path */
  socketPath?: string;

  /** HTTP fallback host */
  httpHost?: string;

  /** HTTP fallback port */
  httpPort?: number;

  /** Request timeout in ms */
  timeout?: number;

  /** Whether to prefer socket over HTTP */
  preferSocket?: boolean;
}

export interface RequestOptions {
  /** Request timeout override */
  timeout?: number;

  /** Force specific channel */
  channel?: 'socket' | 'http';
}

export class BrokerClient {
  private socketPath: string;
  private httpHost: string;
  private httpPort: number;
  private timeout: number;
  private preferSocket: boolean;

  constructor(options: BrokerClientOptions = {}) {
    this.socketPath = options.socketPath || '/var/run/agenshield/agenshield.sock';
    this.httpHost = options.httpHost || 'localhost';
    this.httpPort = options.httpPort || 5201;
    this.timeout = options.timeout || 30000;
    this.preferSocket = options.preferSocket ?? true;
  }

  /**
   * Make an HTTP request through the broker
   */
  async httpRequest(
    params: HttpRequestParams,
    options?: RequestOptions
  ): Promise<HttpRequestResult> {
    return this.request<HttpRequestResult>('http_request', params as unknown as Record<string, unknown>, options);
  }

  /**
   * Read a file through the broker
   */
  async fileRead(
    params: FileReadParams,
    options?: RequestOptions
  ): Promise<FileReadResult> {
    return this.request<FileReadResult>('file_read', params as unknown as Record<string, unknown>, options);
  }

  /**
   * Write a file through the broker
   */
  async fileWrite(
    params: FileWriteParams,
    options?: RequestOptions
  ): Promise<FileWriteResult> {
    return this.request<FileWriteResult>('file_write', params as unknown as Record<string, unknown>, {
      ...options,
      channel: 'socket', // file_write only allowed via socket
    });
  }

  /**
   * List files through the broker
   */
  async fileList(
    params: FileListParams,
    options?: RequestOptions
  ): Promise<FileListResult> {
    return this.request<FileListResult>('file_list', params as unknown as Record<string, unknown>, options);
  }

  /**
   * Execute a command through the broker
   */
  async exec(params: ExecParams, options?: RequestOptions): Promise<ExecResult> {
    return this.request<ExecResult>('exec', params as unknown as Record<string, unknown>, {
      ...options,
      channel: 'socket', // exec only allowed via socket
    });
  }

  /**
   * Open a URL through the broker
   */
  async openUrl(
    params: OpenUrlParams,
    options?: RequestOptions
  ): Promise<OpenUrlResult> {
    return this.request<OpenUrlResult>('open_url', params as unknown as Record<string, unknown>, options);
  }

  /**
   * Inject a secret through the broker
   */
  async secretInject(
    params: SecretInjectParams,
    options?: RequestOptions
  ): Promise<SecretInjectResult> {
    return this.request<SecretInjectResult>('secret_inject', params as unknown as Record<string, unknown>, {
      ...options,
      channel: 'socket', // secret_inject only allowed via socket
    });
  }

  /**
   * Ping the broker
   */
  async ping(echo?: string, options?: RequestOptions): Promise<PingResult> {
    return this.request<PingResult>('ping', { echo }, options);
  }

  /**
   * Install a skill through the broker
   * Socket-only operation due to privileged file operations
   */
  async skillInstall(
    params: SkillInstallParams,
    options?: RequestOptions
  ): Promise<SkillInstallResult> {
    return this.request<SkillInstallResult>('skill_install', params as unknown as Record<string, unknown>, {
      ...options,
      channel: 'socket', // skill_install only allowed via socket
    });
  }

  /**
   * Uninstall a skill through the broker
   * Socket-only operation due to privileged file operations
   */
  async skillUninstall(
    params: SkillUninstallParams,
    options?: RequestOptions
  ): Promise<SkillUninstallResult> {
    return this.request<SkillUninstallResult>('skill_uninstall', params as unknown as Record<string, unknown>, {
      ...options,
      channel: 'socket', // skill_uninstall only allowed via socket
    });
  }

  /**
   * Check if the broker is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      await this.ping();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Make a request to the broker
   */
  private async request<T>(
    method: string,
    params: Record<string, unknown>,
    options?: RequestOptions
  ): Promise<T> {
    const channel = options?.channel || (this.preferSocket ? 'socket' : 'http');
    const timeout = options?.timeout || this.timeout;

    if (channel === 'socket') {
      try {
        return await this.socketRequest<T>(method, params, timeout);
      } catch (error) {
        // Fall back to HTTP if socket fails and not forced
        if (!options?.channel) {
          return await this.httpRequest_internal<T>(method, params, timeout);
        }
        throw error;
      }
    } else {
      return await this.httpRequest_internal<T>(method, params, timeout);
    }
  }

  /**
   * Make a request via Unix socket
   */
  private async socketRequest<T>(
    method: string,
    params: Record<string, unknown>,
    timeout: number
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(this.socketPath);
      const id = randomUUID();

      let responseData = '';
      let timeoutId: NodeJS.Timeout;

      socket.on('connect', () => {
        const request: JsonRpcRequest = {
          jsonrpc: '2.0',
          id,
          method: method as any,
          params,
        };

        socket.write(JSON.stringify(request) + '\n');

        timeoutId = setTimeout(() => {
          socket.destroy();
          reject(new Error('Request timeout'));
        }, timeout);
      });

      socket.on('data', (data) => {
        responseData += data.toString();

        const newlineIndex = responseData.indexOf('\n');
        if (newlineIndex !== -1) {
          clearTimeout(timeoutId);
          socket.end();

          try {
            const response: JsonRpcResponse = JSON.parse(
              responseData.slice(0, newlineIndex)
            );

            if (response.error) {
              const error = new Error(response.error.message) as Error & {
                code: number;
              };
              error.code = response.error.code;
              reject(error);
            } else {
              resolve(response.result as T);
            }
          } catch (error) {
            reject(new Error('Invalid response from broker'));
          }
        }
      });

      socket.on('error', (error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
    });
  }

  /**
   * Make a request via HTTP
   */
  private async httpRequest_internal<T>(
    method: string,
    params: Record<string, unknown>,
    timeout: number
  ): Promise<T> {
    const url = `http://${this.httpHost}:${this.httpPort}/rpc`;
    const id = randomUUID();

    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method: method as any,
      params,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const jsonResponse: JsonRpcResponse = await response.json();

      if (jsonResponse.error) {
        const error = new Error(jsonResponse.error.message) as Error & {
          code: number;
        };
        error.code = jsonResponse.error.code;
        throw error;
      }

      return jsonResponse.result as T;
    } catch (error) {
      clearTimeout(timeoutId);

      if ((error as Error).name === 'AbortError') {
        throw new Error('Request timeout');
      }

      throw error;
    }
  }
}
