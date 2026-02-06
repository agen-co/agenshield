/**
 * Shield-Exec: Single Node.js Command Proxy
 *
 * A unified command proxy installed at /opt/agenshield/bin/shield-exec.
 * All command wrappers in $HOME/bin/ are symlinks to this binary.
 * It detects the invoked command name via process.argv[1] (symlink name),
 * then routes the request through the broker via Unix socket JSON-RPC.
 *
 * All commands are routed as `exec` operations through the broker,
 * which handles policy enforcement (workspace boundaries, network policies, etc.).
 */

import * as path from 'node:path';
import * as net from 'node:net';

/** Path where shield-exec is installed */
export const SHIELD_EXEC_PATH = '/opt/agenshield/bin/shield-exec';

/** Default socket path for broker communication */
const DEFAULT_SOCKET_PATH = '/var/run/agenshield/agenshield.sock';

/** Commands that shield-exec handles (all routed through broker as exec) */
export const PROXIED_COMMANDS = [
  'curl', 'wget', 'git', 'ssh', 'scp', 'rsync',
  'brew', 'npm', 'npx', 'pip', 'pip3',
  'open-url', 'shieldctl', 'agenco',
] as const;

/**
 * JSON-RPC 2.0 request interface
 */
interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string;
  method: string;
  params: Record<string, unknown>;
}

/**
 * JSON-RPC 2.0 response interface
 */
interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string;
  result?: {
    exitCode?: number;
    stdout?: string;
    stderr?: string;
    status?: number;
    body?: string;
    headers?: Record<string, string>;
  };
  error?: { code: number; message: string };
}

/**
 * Send a JSON-RPC request over Unix socket and return the response
 */
function sendRequest(socketPath: string, request: JsonRpcRequest): Promise<JsonRpcResponse> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath, () => {
      socket.write(JSON.stringify(request) + '\n');
    });

    let data = '';
    socket.on('data', (chunk) => {
      data += chunk.toString();
      const newlineIdx = data.indexOf('\n');
      if (newlineIdx >= 0) {
        try {
          const response = JSON.parse(data.slice(0, newlineIdx)) as JsonRpcResponse;
          socket.end();
          resolve(response);
        } catch (err) {
          socket.end();
          reject(new Error(`Invalid JSON response: ${(err as Error).message}`));
        }
      }
    });

    socket.on('error', (err) => {
      reject(new Error(`Socket error: ${err.message}`));
    });

    socket.on('end', () => {
      if (data.trim()) {
        try {
          resolve(JSON.parse(data.trim()) as JsonRpcResponse);
        } catch {
          reject(new Error('Connection closed before response'));
        }
      } else {
        reject(new Error('Connection closed without response'));
      }
    });

    // Timeout after 30 seconds
    socket.setTimeout(30000, () => {
      socket.destroy();
      reject(new Error('Request timed out'));
    });
  });
}

/**
 * Generate a simple request ID
 */
function generateId(): string {
  return `shield-exec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Main entry point - detect command name and route accordingly
 */
async function main(): Promise<void> {
  const socketPath = process.env['AGENSHIELD_SOCKET'] || DEFAULT_SOCKET_PATH;
  const invoked = path.basename(process.argv[1] || 'shield-exec');
  const args = process.argv.slice(2);

  // If invoked directly as shield-exec, require command name as first arg
  const commandName = invoked === 'shield-exec' ? (args.shift() || '') : invoked;

  if (!commandName) {
    process.stderr.write('Usage: shield-exec <command> [args...]\n');
    process.exit(1);
  }

  // All commands route as exec through the broker.
  // The broker handles policy enforcement (workspace boundaries, network policies, etc.)
  const request: JsonRpcRequest = {
    jsonrpc: '2.0',
    id: generateId(),
    method: 'exec',
    params: {
      command: commandName,
      args,
      cwd: process.cwd(),
    },
  };

  try {
    const response = await sendRequest(socketPath, request);

    // Handle JSON-RPC level errors
    if (response.error) {
      process.stderr.write(`Error: ${response.error.message}\n`);
      process.exit(1);
    }

    const data = response.result;
    if (!data) {
      process.exit(0);
    }

    // Handle exec response
    if (data.stdout) {
      process.stdout.write(data.stdout);
    }
    if (data.stderr) {
      process.stderr.write(data.stderr);
    }
    process.exit(data.exitCode ?? 0);
  } catch (err) {
    process.stderr.write(`shield-exec error: ${(err as Error).message}\n`);
    process.exit(1);
  }
}

// Run if executed directly
if (process.argv[1]?.endsWith('shield-exec')) {
  main().catch((err) => {
    process.stderr.write(`Fatal: ${err.message}\n`);
    process.exit(1);
  });
}

/**
 * The content of shield-exec as a string, for installation
 */
export const SHIELD_EXEC_CONTENT = `#!/opt/agenshield/bin/node-bin
import path from 'node:path';
import net from 'node:net';

const DEFAULT_SOCKET_PATH = '/var/run/agenshield/agenshield.sock';

function sendRequest(socketPath, request) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath, () => {
      socket.write(JSON.stringify(request) + '\\n');
    });
    let data = '';
    socket.on('data', (chunk) => {
      data += chunk.toString();
      const idx = data.indexOf('\\n');
      if (idx >= 0) {
        try {
          const resp = JSON.parse(data.slice(0, idx));
          socket.end();
          resolve(resp);
        } catch (e) {
          socket.end();
          reject(new Error('Invalid JSON response: ' + e.message));
        }
      }
    });
    socket.on('error', (err) => reject(new Error('Socket error: ' + err.message)));
    socket.on('end', () => {
      if (data.trim()) {
        try { resolve(JSON.parse(data.trim())); }
        catch { reject(new Error('Connection closed before response')); }
      } else {
        reject(new Error('Connection closed without response'));
      }
    });
    socket.setTimeout(30000, () => {
      socket.destroy();
      reject(new Error('Request timed out'));
    });
  });
}

async function main() {
  const socketPath = process.env.AGENSHIELD_SOCKET || DEFAULT_SOCKET_PATH;
  const invoked = path.basename(process.argv[1] || 'shield-exec');
  const args = process.argv.slice(2);
  const commandName = invoked === 'shield-exec' ? (args.shift() || '') : invoked;

  if (!commandName) {
    process.stderr.write('Usage: shield-exec <command> [args...]\\n');
    process.exit(1);
  }

  const request = {
    jsonrpc: '2.0',
    id: 'shield-exec-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    method: 'exec',
    params: { command: commandName, args: args, cwd: process.cwd() },
  };

  try {
    const response = await sendRequest(socketPath, request);
    if (response.error) {
      process.stderr.write('Error: ' + response.error.message + '\\n');
      process.exit(1);
    }
    const data = response.result;
    if (!data) process.exit(0);
    if (data.stdout) process.stdout.write(data.stdout);
    if (data.stderr) process.stderr.write(data.stderr);
    process.exit(data.exitCode ?? 0);
  } catch (err) {
    process.stderr.write('shield-exec error: ' + err.message + '\\n');
    process.exit(1);
  }
}

main().catch((err) => { process.stderr.write('Fatal: ' + err.message + '\\n'); process.exit(1); });
`;
