/**
 * Sync Client
 *
 * Synchronous client for intercepting sync operations like execSync.
 * Uses a subprocess to make async calls synchronously.
 */

import { execSync as nodeExecSync, spawnSync } from 'node:child_process';
import * as net from 'node:net';
import * as fs from 'node:fs';
import { randomUUID } from 'node:crypto';

export interface SyncClientOptions {
  socketPath: string;
  httpHost: string;
  httpPort: number;
  timeout: number;
}

export class SyncClient {
  private socketPath: string;
  private httpHost: string;
  private httpPort: number;
  private timeout: number;

  constructor(options: SyncClientOptions) {
    this.socketPath = options.socketPath;
    this.httpHost = options.httpHost;
    this.httpPort = options.httpPort;
    this.timeout = options.timeout;
  }

  /**
   * Send a synchronous request to the broker
   */
  request<T>(method: string, params: Record<string, unknown>): T {
    // Try socket first using a synchronous approach
    try {
      return this.socketRequestSync<T>(method, params);
    } catch {
      // Fall back to HTTP via subprocess
      return this.httpRequestSync<T>(method, params);
    }
  }

  /**
   * Synchronous socket request
   *
   * This uses a blocking approach with a temporary file for the response.
   */
  private socketRequestSync<T>(
    method: string,
    params: Record<string, unknown>
  ): T {
    const id = randomUUID();
    const request = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params,
    }) + '\n';

    // Create a temporary file for the response
    const tmpFile = `/tmp/agenshield-sync-${id}.json`;

    // Use a small Node.js script to make the request
    const script = `
      const net = require('net');
      const fs = require('fs');

      const socket = net.createConnection('${this.socketPath}');
      let data = '';

      socket.on('connect', () => {
        socket.write(${JSON.stringify(request)});
      });

      socket.on('data', (chunk) => {
        data += chunk.toString();
        if (data.includes('\\n')) {
          socket.end();
          fs.writeFileSync('${tmpFile}', data.split('\\n')[0]);
        }
      });

      socket.on('error', (err) => {
        fs.writeFileSync('${tmpFile}', JSON.stringify({ error: err.message }));
      });

      setTimeout(() => {
        socket.destroy();
        fs.writeFileSync('${tmpFile}', JSON.stringify({ error: 'timeout' }));
      }, ${this.timeout});
    `;

    try {
      // Run the script synchronously
      spawnSync('node', ['-e', script], {
        timeout: this.timeout + 1000,
        stdio: 'ignore',
      });

      // Read the response
      if (fs.existsSync(tmpFile)) {
        const response = JSON.parse(fs.readFileSync(tmpFile, 'utf-8'));
        fs.unlinkSync(tmpFile);

        if (response.error) {
          throw new Error(response.error);
        }

        return response.result as T;
      }

      throw new Error('No response from broker');
    } finally {
      // Clean up
      try {
        if (fs.existsSync(tmpFile)) {
          fs.unlinkSync(tmpFile);
        }
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Synchronous HTTP request using curl
   */
  private httpRequestSync<T>(
    method: string,
    params: Record<string, unknown>
  ): T {
    const url = `http://${this.httpHost}:${this.httpPort}/rpc`;
    const id = randomUUID();

    const request = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params,
    });

    try {
      // Use curl for synchronous HTTP request
      const result = nodeExecSync(
        `curl -s -X POST -H "Content-Type: application/json" -d '${request.replace(/'/g, "\\'")}' "${url}"`,
        {
          timeout: this.timeout,
          encoding: 'utf-8',
        }
      );

      const response = JSON.parse(result);

      if (response.error) {
        throw new Error(response.error.message);
      }

      return response.result as T;
    } catch (error) {
      throw new Error(`Sync request failed: ${(error as Error).message}`);
    }
  }

  /**
   * Check if broker is available
   */
  ping(): boolean {
    try {
      this.request('ping', {});
      return true;
    } catch {
      return false;
    }
  }
}
