/**
 * Privilege helper — standalone script that runs as root.
 *
 * Spawned via `osascript -e 'do shell script "..." with administrator privileges'`,
 * it creates a Unix domain socket and accepts JSON-RPC commands for executing
 * privileged operations on behalf of the daemon.
 *
 * Usage: node helper.js <socketPath>
 *
 * Runs for the daemon's lifetime. The daemon sends periodic `ping` heartbeats
 * to verify the helper is alive. Exits cleanly on `shutdown` RPC or signal.
 * Falls back to a 24-hour idle timeout as a safety net.
 */

import * as net from 'node:net';
import * as fs from 'node:fs';
import { spawn } from 'node:child_process';

const IDLE_TIMEOUT_MS = 24 * 60 * 60_000; // 24h safety net
const MAX_OUTPUT = 4096; // 4 KB — keep only the tail for error reporting

/** Truncate command output to the last MAX_OUTPUT bytes to avoid multi-MB JSON over the socket. */
function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT) return output;
  return '...[truncated]\n' + output.slice(-MAX_OUTPUT);
}

/** Ring buffer that keeps only the last `capacity` bytes of streamed output. */
class RingBuffer {
  private chunks: string[] = [];
  private totalLength = 0;
  constructor(private capacity: number) {}

  append(data: string): void {
    this.chunks.push(data);
    this.totalLength += data.length;
    // Trim when we've accumulated 2x capacity to avoid frequent joins
    if (this.totalLength > this.capacity * 2) {
      const joined = this.chunks.join('');
      this.chunks = [joined.slice(-this.capacity)];
      this.totalLength = this.chunks[0].length;
    }
  }

  toString(): string {
    const joined = this.chunks.join('');
    if (joined.length <= this.capacity) return joined;
    return joined.slice(-this.capacity);
  }
}

/**
 * Spawn a command in a shell and stream output. Returns a promise that
 * resolves with { code, stdout, stderr } once the child exits or the
 * timeout fires.
 */
function spawnCommand(
  command: string,
  timeout: number,
  env?: NodeJS.ProcessEnv,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('/bin/bash', ['-c', command], {
      cwd: '/',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...env, NODE_OPTIONS: '' },
    });

    const stdoutBuf = new RingBuffer(MAX_OUTPUT);
    const stderrBuf = new RingBuffer(MAX_OUTPUT);
    let settled = false;

    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout: stdoutBuf.toString(), stderr: stderrBuf.toString() });
    };

    child.stdout.on('data', (d: Buffer) => stdoutBuf.append(d.toString()));
    child.stderr.on('data', (d: Buffer) => stderrBuf.append(d.toString()));

    child.on('close', (code) => finish(code ?? 1));
    child.on('error', (err) => {
      stderrBuf.append(err.message);
      finish(1);
    });

    const timer = setTimeout(() => {
      if (!settled) {
        stderrBuf.append(`\nTimeout: command exceeded ${timeout}ms — sending SIGTERM\n`);
        child.kill('SIGTERM');
        // Give 5s for graceful exit, then SIGKILL
        setTimeout(() => {
          if (!settled) {
            child.kill('SIGKILL');
            finish(124); // 124 = timeout convention
          }
        }, 5_000);
      }
    }, timeout);
  });
}

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

  async function handleRequest(req: RpcRequest): Promise<RpcResponse> {
    resetIdleTimer();

    switch (req.method) {
      case 'ping':
        return { id: req.id, result: { ok: true, pid: process.pid, uid: process.getuid?.() } };

      case 'exec': {
        const command = req.params?.command;
        if (!command) {
          return { id: req.id, error: { code: -1, message: 'Missing command parameter' } };
        }
        const timeout = req.params?.timeout ?? 300_000;
        const { code, stdout, stderr } = await spawnCommand(command, timeout, process.env);
        if (code === 0) {
          return { id: req.id, result: { success: true, output: truncateOutput(stdout.trim()) } };
        }
        return {
          id: req.id,
          error: {
            code: code,
            message: truncateOutput(stderr.trim() || `Command exited with code ${code}`),
          },
        };
      }

      case 'execAsUser': {
        const command = req.params?.command;
        const user = req.params?.user;
        if (!command || !user) {
          return { id: req.id, error: { code: -1, message: 'Missing command or user parameter' } };
        }
        const timeout = req.params?.timeout ?? 300_000;
        const wrappedCmd = `sudo -H -u ${user} /bin/bash -c ${JSON.stringify(command)}`;
        const { code, stdout, stderr } = await spawnCommand(wrappedCmd, timeout, process.env);
        if (code === 0) {
          return { id: req.id, result: { success: true, output: truncateOutput(stdout.trim()) } };
        }
        return {
          id: req.id,
          error: {
            code: code,
            message: truncateOutput(stderr.trim() || `Command exited with code ${code}`),
          },
        };
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
          handleRequest(req).then((res) => {
            socket.write(JSON.stringify(res) + '\n');
          }).catch((err) => {
            socket.write(JSON.stringify({
              id: req.id,
              error: { code: -32603, message: `Internal error: ${(err as Error).message}` },
            }) + '\n');
          });
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
