/**
 * Async HTTP Client
 *
 * Async client for communicating with the broker daemon.
 */

import * as net from 'node:net';
import { randomUUID } from 'node:crypto';
import { BrokerUnavailableError, TimeoutError } from '../errors.js';

export interface AsyncClientOptions {
  socketPath: string;
  httpHost: string;
  httpPort: number;
  timeout: number;
}

export interface BrokerRequest {
  jsonrpc: '2.0';
  id: string;
  method: string;
  params: Record<string, unknown>;
}

export interface BrokerResponse {
  jsonrpc: '2.0';
  id: string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
}

export class AsyncClient {
  private socketPath: string;
  private httpHost: string;
  private httpPort: number;
  private timeout: number;

  constructor(options: AsyncClientOptions) {
    this.socketPath = options.socketPath;
    this.httpHost = options.httpHost;
    this.httpPort = options.httpPort;
    this.timeout = options.timeout;
  }

  /**
   * Send a request to the broker
   */
  async request<T>(
    method: string,
    params: Record<string, unknown>
  ): Promise<T> {
    try {
      // Try socket first
      return await this.socketRequest<T>(method, params);
    } catch (socketError) {
      // Fall back to HTTP
      try {
        return await this.httpRequest<T>(method, params);
      } catch (httpError) {
        throw new BrokerUnavailableError(
          `Failed to connect to broker: ${(socketError as Error).message}`
        );
      }
    }
  }

  /**
   * Send request via Unix socket
   */
  private async socketRequest<T>(
    method: string,
    params: Record<string, unknown>
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(this.socketPath);
      const id = randomUUID();

      let responseData = '';
      let timeoutId: NodeJS.Timeout;

      socket.on('connect', () => {
        const request: BrokerRequest = {
          jsonrpc: '2.0',
          id,
          method,
          params,
        };

        socket.write(JSON.stringify(request) + '\n');

        timeoutId = setTimeout(() => {
          socket.destroy();
          reject(new TimeoutError());
        }, this.timeout);
      });

      socket.on('data', (data) => {
        responseData += data.toString();

        const newlineIndex = responseData.indexOf('\n');
        if (newlineIndex !== -1) {
          clearTimeout(timeoutId);
          socket.end();

          try {
            const response: BrokerResponse = JSON.parse(
              responseData.slice(0, newlineIndex)
            );

            if (response.error) {
              reject(new Error(response.error.message));
            } else {
              resolve(response.result as T);
            }
          } catch {
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
   * Send request via HTTP
   */
  private async httpRequest<T>(
    method: string,
    params: Record<string, unknown>
  ): Promise<T> {
    const url = `http://${this.httpHost}:${this.httpPort}/rpc`;
    const id = randomUUID();

    const request: BrokerRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

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

      const jsonResponse: BrokerResponse = await response.json();

      if (jsonResponse.error) {
        throw new Error(jsonResponse.error.message);
      }

      return jsonResponse.result as T;
    } catch (error) {
      clearTimeout(timeoutId);

      if ((error as Error).name === 'AbortError') {
        throw new TimeoutError();
      }

      throw error;
    }
  }

  /**
   * Check if broker is available
   */
  async ping(): Promise<boolean> {
    try {
      await this.request('ping', {});
      return true;
    } catch {
      return false;
    }
  }
}
