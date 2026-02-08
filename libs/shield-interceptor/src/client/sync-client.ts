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
import { debugLog } from '../debug-log.js';

// Capture original function references BEFORE any interceptor can patch them.
// These run at module load time (during require()), before installInterceptors().
// Stored in module closure — unreachable by external code.
const _existsSync = fs.existsSync.bind(fs);
const _readFileSync = fs.readFileSync.bind(fs);
const _unlinkSync = fs.unlinkSync.bind(fs);
const _readdirSync = fs.readdirSync.bind(fs);
const _statSync = fs.statSync.bind(fs);
const _spawnSync = spawnSync;
const _execSync = nodeExecSync;

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
  private socketFailCount = 0;
  private socketSkipUntil = 0;

  constructor(options: SyncClientOptions) {
    this.socketPath = options.socketPath;
    this.httpHost = options.httpHost;
    this.httpPort = options.httpPort;
    this.timeout = options.timeout;
    this.cleanupStaleTmpFiles();
  }

  /**
   * Remove stale /tmp/agenshield-sync-*.json files from previous runs
   */
  private cleanupStaleTmpFiles(): void {
    try {
      const tmpDir = '/tmp';
      const files = _readdirSync(tmpDir);
      const cutoff = Date.now() - 5 * 60 * 1000;
      for (const f of files) {
        if (f.startsWith('agenshield-sync-') && f.endsWith('.json')) {
          const fp = `${tmpDir}/${f}`;
          try {
            const stat = _statSync(fp);
            if (stat.mtimeMs < cutoff) _unlinkSync(fp);
          } catch { /* ignore per-file errors */ }
        }
      }
    } catch { /* ignore cleanup errors */ }
  }

  /**
   * Send a synchronous request to the broker
   */
  request<T>(method: string, params: Record<string, unknown>): T {
    debugLog(`syncClient.request START method=${method}`);
    const now = Date.now();

    // Circuit breaker: skip socket if it failed recently
    if (now < this.socketSkipUntil) {
      debugLog(`syncClient.request SKIP socket (circuit open for ${this.socketSkipUntil - now}ms), using HTTP`);
      const result = this.httpRequestSync<T>(method, params);
      debugLog(`syncClient.request http OK method=${method}`);
      return result;
    }

    // Try socket first using a synchronous approach
    try {
      const result = this.socketRequestSync<T>(method, params);
      this.socketFailCount = 0; // Reset on success
      debugLog(`syncClient.request socket OK method=${method}`);
      return result;
    } catch (socketErr) {
      this.socketFailCount++;
      // After 2 consecutive failures, skip socket for 60 seconds
      if (this.socketFailCount >= 2) {
        this.socketSkipUntil = Date.now() + 60_000;
        debugLog(`syncClient.request socket circuit OPEN (${this.socketFailCount} failures)`);
      }
      debugLog(`syncClient.request socket FAILED: ${(socketErr as Error).message}, trying HTTP`);
      // Fall back to HTTP via subprocess
      const result = this.httpRequestSync<T>(method, params);
      debugLog(`syncClient.request http OK method=${method}`);
      return result;
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

    // Use a small Node.js script to make the request.
    // Key: clearTimeout + process.exit(0) on data to avoid blocking for the full timeout.
    const script = `
      const net = require('net');
      const fs = require('fs');

      let done = false;
      const socket = net.createConnection('${this.socketPath}');
      let data = '';

      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        socket.destroy();
        fs.writeFileSync('${tmpFile}', JSON.stringify({ error: 'timeout' }));
        process.exit(1);
      }, ${this.timeout});

      socket.on('connect', () => {
        socket.write(${JSON.stringify(request)});
      });

      socket.on('data', (chunk) => {
        data += chunk.toString();
        if (data.includes('\\n') && !done) {
          done = true;
          clearTimeout(timer);
          socket.end();
          fs.writeFileSync('${tmpFile}', data.split('\\n')[0]);
          process.exit(0);
        }
      });

      socket.on('error', (err) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        fs.writeFileSync('${tmpFile}', JSON.stringify({ error: err.message }));
        process.exit(1);
      });
    `;

    try {
      // Run the script synchronously using the unintercepted node binary.
      // We must use the absolute path to node-bin to avoid the wrapper that
      // sets NODE_OPTIONS (which loads the interceptor → infinite recursion).
      debugLog(`syncClient.socketRequestSync _spawnSync START node-bin method=${method}`);
      const spawnResult = _spawnSync('/opt/agenshield/bin/node-bin', ['-e', script], {
        timeout: this.timeout + 1000,
        stdio: 'ignore',
        env: { ...process.env, NODE_OPTIONS: '' },
      });
      debugLog(`syncClient.socketRequestSync _spawnSync DONE status=${spawnResult?.status} signal=${spawnResult?.signal} error=${spawnResult?.error?.message || 'none'}`);

      // Read the response (use captured originals to avoid interception)
      const tmpExists = _existsSync(tmpFile);
      debugLog(`syncClient.socketRequestSync tmpFile exists=${tmpExists}`);
      if (tmpExists) {
        const raw = _readFileSync(tmpFile, 'utf-8');
        debugLog(`syncClient.socketRequestSync response raw=${raw.slice(0, 200)}`);
        const response = JSON.parse(raw);
        _unlinkSync(tmpFile);

        if (response.error) {
          throw new Error(response.error);
        }

        return response.result as T;
      }

      throw new Error('No response from broker');
    } finally {
      // Clean up (use captured originals to avoid interception)
      try {
        if (_existsSync(tmpFile)) {
          _unlinkSync(tmpFile);
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
      // Use curl for synchronous HTTP request (use captured original to avoid interception).
      // Absolute path avoids the guarded shell's restricted PATH ($HOME/bin).
      debugLog(`syncClient.httpRequestSync curl START url=${url} method=${method}`);
      const result = _execSync(
        `/usr/bin/curl -s -X POST -H "Content-Type: application/json" -d '${request.replace(/'/g, "\\'")}' "${url}"`,
        {
          timeout: this.timeout,
          encoding: 'utf-8',
        }
      );
      debugLog(`syncClient.httpRequestSync curl DONE len=${result?.length}`);

      const response = JSON.parse(result);

      if (response.error) {
        throw new Error(response.error.message);
      }

      return response.result as T;
    } catch (error) {
      debugLog(`syncClient.httpRequestSync FAILED: ${(error as Error).message}`);
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
