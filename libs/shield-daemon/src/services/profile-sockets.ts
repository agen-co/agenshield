/**
 * Per-Profile Daemon Socket Manager
 *
 * Creates a Unix socket at {brokerHomeDir}/daemon.sock for each target profile.
 * When a broker connects to its socket, the daemon knows the profileId from
 * the socket-to-profile mapping. OS file permissions provide access control.
 *
 * Uses the same JSON-RPC 2.0 protocol (newline-delimited) that the broker already speaks.
 */

import * as net from 'node:net';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Profile } from '@agenshield/ipc';
import type { Storage } from '@agenshield/storage';

const SOCKET_FILENAME = 'daemon.sock';

export type RpcHandler = (
  params: Record<string, unknown>,
  profileId: string,
) => unknown | Promise<unknown>;

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string };
}

interface SocketEntry {
  profileId: string;
  socketPath: string;
  server: net.Server;
  connections: Set<net.Socket>;
}

export class ProfileSocketManager {
  private sockets = new Map<string, SocketEntry>();
  private storage: Storage;
  private handlers: Record<string, RpcHandler>;

  constructor(storage: Storage, handlers: Record<string, RpcHandler>) {
    this.storage = storage;
    this.handlers = handlers;
  }

  /**
   * Start sockets for all target profiles that have a brokerHomeDir.
   */
  async start(): Promise<void> {
    const profiles = this.storage.profiles.getByType('target');
    for (const profile of profiles) {
      if (profile.brokerHomeDir) {
        await this.startSocket(profile.id, profile.brokerHomeDir);
      }
    }
  }

  /**
   * Stop all sockets and clean up .sock files.
   */
  async stop(): Promise<void> {
    const stops = Array.from(this.sockets.values()).map((entry) =>
      this.stopSocket(entry),
    );
    await Promise.all(stops);
    this.sockets.clear();
  }

  /**
   * Called when a new profile is created.
   */
  async onProfileCreated(profile: Profile): Promise<void> {
    if (profile.type === 'target' && profile.brokerHomeDir) {
      await this.startSocket(profile.id, profile.brokerHomeDir);
    }
  }

  /**
   * Called when a profile is deleted.
   */
  async onProfileDeleted(profileId: string, brokerHomeDir?: string): Promise<void> {
    const entry = this.sockets.get(profileId);
    if (entry) {
      await this.stopSocket(entry);
      this.sockets.delete(profileId);
    } else if (brokerHomeDir) {
      // Clean up socket file even if not tracked
      const socketPath = path.join(brokerHomeDir, SOCKET_FILENAME);
      try { fs.unlinkSync(socketPath); } catch { /* non-fatal */ }
    }
  }

  private async startSocket(profileId: string, brokerHomeDir: string): Promise<void> {
    const socketPath = path.join(brokerHomeDir, SOCKET_FILENAME);

    // Ensure directory exists
    if (!fs.existsSync(brokerHomeDir)) {
      fs.mkdirSync(brokerHomeDir, { recursive: true });
    }

    // Remove stale socket file
    if (fs.existsSync(socketPath)) {
      try { fs.unlinkSync(socketPath); } catch { /* non-fatal */ }
    }

    const connections = new Set<net.Socket>();

    const server = net.createServer((socket) => {
      connections.add(socket);
      this.handleConnection(profileId, socket, connections);
    });

    return new Promise<void>((resolve, reject) => {
      server.on('error', (err) => {
        console.error(`[ProfileSockets] Failed to start socket for ${profileId}: ${err.message}`);
        reject(err);
      });

      server.listen(socketPath, () => {
        try {
          fs.chmodSync(socketPath, 0o660);
        } catch {
          // Best effort — may not have permission
        }
        console.log(`[ProfileSockets] Listening: ${socketPath} (profile: ${profileId})`);
        this.sockets.set(profileId, { profileId, socketPath, server, connections });
        resolve();
      });
    });
  }

  private async stopSocket(entry: SocketEntry): Promise<void> {
    // Destroy all active connections
    for (const conn of entry.connections) {
      conn.destroy();
    }
    entry.connections.clear();

    return new Promise<void>((resolve) => {
      entry.server.close(() => {
        try { fs.unlinkSync(entry.socketPath); } catch { /* non-fatal */ }
        resolve();
      });
    });
  }

  private handleConnection(
    profileId: string,
    socket: net.Socket,
    connections: Set<net.Socket>,
  ): void {
    let buffer = '';

    socket.on('data', async (data) => {
      buffer += data.toString();

      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);

        if (line.trim()) {
          const response = await this.processRequest(profileId, line);
          socket.write(JSON.stringify(response) + '\n');
        }
      }
    });

    socket.on('close', () => {
      connections.delete(socket);
    });

    socket.on('error', () => {
      connections.delete(socket);
    });
  }

  private async processRequest(
    profileId: string,
    line: string,
  ): Promise<JsonRpcResponse> {
    let request: JsonRpcRequest;
    try {
      request = JSON.parse(line);
    } catch {
      return { jsonrpc: '2.0', id: 0, error: { code: -32700, message: 'Parse error' } };
    }

    if (request.jsonrpc !== '2.0' || !request.method || request.id === undefined) {
      return { jsonrpc: '2.0', id: request.id ?? 0, error: { code: -32600, message: 'Invalid Request' } };
    }

    const handler = this.handlers[request.method];
    if (!handler) {
      return { jsonrpc: '2.0', id: request.id, error: { code: -32601, message: `Method not found: ${request.method}` } };
    }

    try {
      const result = await handler(request.params ?? {}, profileId);
      return { jsonrpc: '2.0', id: request.id, result };
    } catch (error) {
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32000,
          message: error instanceof Error ? error.message : 'Internal error',
        },
      };
    }
  }
}
