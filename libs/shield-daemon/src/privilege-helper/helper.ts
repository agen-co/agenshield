/**
 * Privilege helper — standalone script that runs as root.
 *
 * Spawned via `osascript -e 'do shell script "..." with administrator privileges'`,
 * it creates a Unix domain socket and accepts JSON-RPC commands for executing
 * privileged operations on behalf of the daemon.
 *
 * Usage: node helper.js <socketPath>
 *
 * Auto-exits after 60 seconds of inactivity.
 */

import * as net from 'node:net';
import * as fs from 'node:fs';
import { execSync } from 'node:child_process';

const IDLE_TIMEOUT_MS = 60_000;

interface RpcRequest {
  id: number;
  method: 'exec' | 'execAsUser' | 'ping' | 'shutdown';
  params?: {
    command?: string;
    user?: string;
    timeout?: number;
  };
}

interface RpcResponse {
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

function main(): void {
  const socketPath = process.argv[2];
  if (!socketPath) {
    process.stderr.write('Usage: node helper.js <socketPath>\n');
    process.exit(1);
  }

  // Clean up stale socket
  if (fs.existsSync(socketPath)) {
    fs.unlinkSync(socketPath);
  }

  let idleTimer: ReturnType<typeof setTimeout>;

  function resetIdleTimer(): void {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      process.stderr.write('[privilege-helper] Idle timeout — shutting down\n');
      server.close();
      cleanup();
      process.exit(0);
    }, IDLE_TIMEOUT_MS);
  }

  function cleanup(): void {
    try {
      if (fs.existsSync(socketPath)) {
        fs.unlinkSync(socketPath);
      }
    } catch { /* ignore */ }
  }

  function handleRequest(req: RpcRequest): RpcResponse {
    resetIdleTimer();

    switch (req.method) {
      case 'ping':
        return { id: req.id, result: { ok: true, pid: process.pid, uid: process.getuid?.() } };

      case 'exec': {
        const command = req.params?.command;
        if (!command) {
          return { id: req.id, error: { code: -1, message: 'Missing command parameter' } };
        }
        try {
          const timeout = req.params?.timeout ?? 300_000;
          const output = execSync(command, {
            encoding: 'utf-8',
            timeout,
            stdio: ['pipe', 'pipe', 'pipe'],
          });
          return { id: req.id, result: { success: true, output: output.trim() } };
        } catch (err) {
          const e = err as { status?: number; stderr?: string; message: string };
          return {
            id: req.id,
            error: {
              code: e.status ?? -1,
              message: e.stderr?.trim() || e.message,
            },
          };
        }
      }

      case 'execAsUser': {
        const command = req.params?.command;
        const user = req.params?.user;
        if (!command || !user) {
          return { id: req.id, error: { code: -1, message: 'Missing command or user parameter' } };
        }
        try {
          const timeout = req.params?.timeout ?? 300_000;
          const output = execSync(`sudo -H -u ${user} /bin/bash -c ${JSON.stringify(command)}`, {
            encoding: 'utf-8',
            timeout,
            stdio: ['pipe', 'pipe', 'pipe'],
          });
          return { id: req.id, result: { success: true, output: output.trim() } };
        } catch (err) {
          const e = err as { status?: number; stderr?: string; message: string };
          return {
            id: req.id,
            error: {
              code: e.status ?? -1,
              message: e.stderr?.trim() || e.message,
            },
          };
        }
      }

      case 'shutdown':
        process.nextTick(() => {
          server.close();
          cleanup();
          process.exit(0);
        });
        return { id: req.id, result: { ok: true } };

      default:
        return { id: req.id, error: { code: -32601, message: `Unknown method: ${req.method}` } };
    }
  }

  const server = net.createServer((socket) => {
    let buffer = '';

    socket.on('data', (data) => {
      buffer += data.toString();

      // Process complete JSON messages (newline-delimited)
      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx);
        buffer = buffer.slice(newlineIdx + 1);

        if (!line.trim()) continue;

        try {
          const req = JSON.parse(line) as RpcRequest;
          const res = handleRequest(req);
          socket.write(JSON.stringify(res) + '\n');
        } catch (err) {
          socket.write(JSON.stringify({
            id: 0,
            error: { code: -32700, message: `Parse error: ${(err as Error).message}` },
          }) + '\n');
        }
      }
    });
  });

  server.listen(socketPath, () => {
    // Set socket permissions so the daemon user can connect
    fs.chmodSync(socketPath, 0o660);

    process.stderr.write(`[privilege-helper] Listening on ${socketPath} (PID: ${process.pid})\n`);
    resetIdleTimer();
  });

  server.on('error', (err) => {
    process.stderr.write(`[privilege-helper] Server error: ${err.message}\n`);
    cleanup();
    process.exit(1);
  });

  // Graceful shutdown on signals
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
    process.on(sig, () => {
      process.stderr.write(`[privilege-helper] Received ${sig} — shutting down\n`);
      server.close();
      cleanup();
      process.exit(0);
    });
  }
}

main();
