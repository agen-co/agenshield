/**
 * Shield-Exec: Single Node.js Command Proxy
 *
 * A unified command proxy installed at /opt/agenshield/bin/shield-exec.
 * All command wrappers in $HOME/bin/ are symlinks to this binary.
 * It detects the invoked command name via process.argv[1] (symlink name),
 * then routes the request through the broker via Unix socket JSON-RPC.
 *
 * HTTP commands (curl, wget) are routed as `http_request` operations.
 * All other commands are routed as `exec` operations.
 */

import * as path from 'node:path';
import * as net from 'node:net';

/** Path where shield-exec is installed */
export const SHIELD_EXEC_PATH = '/opt/agenshield/bin/shield-exec';

/** Default socket path for broker communication */
const DEFAULT_SOCKET_PATH = '/var/run/agenshield/agenshield.sock';

/** Commands that should route as http_request to the broker */
const HTTP_COMMANDS = new Set(['curl', 'wget']);

/** Commands that shield-exec handles (all routed through broker) */
export const PROXIED_COMMANDS = [
  'curl', 'wget', 'git', 'ssh', 'scp', 'rsync',
  'brew', 'npm', 'npx', 'pip', 'pip3',
  'open-url', 'shieldctl', 'agentlink',
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
    success: boolean;
    data?: {
      exitCode?: number;
      stdout?: string;
      stderr?: string;
      status?: number;
      body?: string;
      headers?: Record<string, string>;
    };
    error?: { code: number; message: string };
  };
  error?: { code: number; message: string };
}

/**
 * Parse curl arguments into HttpRequestParams
 */
function parseCurlArgs(args: string[]): { url: string; method: string; headers: Record<string, string>; body?: string } {
  let url = '';
  let method = 'GET';
  const headers: Record<string, string> = {};
  let body: string | undefined;

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    switch (arg) {
      case '-X':
      case '--request':
        method = args[++i] || 'GET';
        break;
      case '-H':
      case '--header': {
        const header = args[++i] || '';
        const colonIdx = header.indexOf(':');
        if (colonIdx > 0) {
          headers[header.slice(0, colonIdx).trim()] = header.slice(colonIdx + 1).trim();
        }
        break;
      }
      case '-d':
      case '--data':
      case '--data-raw':
        body = args[++i];
        if (method === 'GET') method = 'POST';
        break;
      case '-I':
      case '--head':
        method = 'HEAD';
        break;
      case '-o':
      case '--output':
      case '-O':
      case '--remote-name':
        i++; // skip output file arg
        break;
      case '-s':
      case '--silent':
      case '-S':
      case '--show-error':
      case '-f':
      case '--fail':
      case '-L':
      case '--location':
      case '-v':
      case '--verbose':
      case '-k':
      case '--insecure':
        // flags without values, skip
        break;
      default:
        if (!arg.startsWith('-')) {
          url = arg;
        }
        break;
    }
    i++;
  }

  return { url, method, headers, body };
}

/**
 * Parse wget arguments into HttpRequestParams
 */
function parseWgetArgs(args: string[]): { url: string; method: string; headers: Record<string, string>; body?: string } {
  let url = '';
  const headers: Record<string, string> = {};

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === '--header') {
      const header = args[++i] || '';
      const colonIdx = header.indexOf(':');
      if (colonIdx > 0) {
        headers[header.slice(0, colonIdx).trim()] = header.slice(colonIdx + 1).trim();
      }
    } else if (arg === '-O' || arg === '--output-document') {
      i++; // skip output file
    } else if (!arg.startsWith('-')) {
      url = arg;
    }
    i++;
  }

  return { url, method: 'GET', headers };
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

  let request: JsonRpcRequest;

  if (HTTP_COMMANDS.has(commandName)) {
    // Route HTTP commands as http_request
    const parsed = commandName === 'curl'
      ? parseCurlArgs(args)
      : parseWgetArgs(args);

    if (!parsed.url) {
      process.stderr.write(`Usage: ${commandName} [options] <url>\n`);
      process.exit(1);
    }

    request = {
      jsonrpc: '2.0',
      id: generateId(),
      method: 'http_request',
      params: {
        url: parsed.url,
        method: parsed.method,
        headers: parsed.headers,
        ...(parsed.body !== undefined ? { body: parsed.body } : {}),
      },
    };
  } else {
    // Route as exec command through broker
    request = {
      jsonrpc: '2.0',
      id: generateId(),
      method: 'exec',
      params: {
        command: commandName,
        args,
      },
    };
  }

  try {
    const response = await sendRequest(socketPath, request);

    // Handle JSON-RPC level errors
    if (response.error) {
      process.stderr.write(`Error: ${response.error.message}\n`);
      process.exit(1);
    }

    const result = response.result;
    if (!result) {
      process.stderr.write('Error: Empty response from broker\n');
      process.exit(1);
    }

    if (!result.success) {
      const errMsg = result.error?.message || 'Unknown error';
      process.stderr.write(`Error: ${errMsg}\n`);
      process.exit(1);
    }

    const data = result.data;
    if (!data) {
      process.exit(0);
    }

    // Handle HTTP response
    if (request.method === 'http_request') {
      if (data.body) {
        process.stdout.write(data.body);
      }
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
if (require.main === module || process.argv[1]?.endsWith('shield-exec')) {
  main().catch((err) => {
    process.stderr.write(`Fatal: ${err.message}\n`);
    process.exit(1);
  });
}

/**
 * The content of shield-exec as a string, for installation
 */
export const SHIELD_EXEC_CONTENT = `#!/usr/bin/env node
'use strict';

const path = require('path');
const net = require('net');

const DEFAULT_SOCKET_PATH = '/var/run/agenshield/agenshield.sock';
const HTTP_COMMANDS = new Set(['curl', 'wget']);

function parseCurlArgs(args) {
  let url = '';
  let method = 'GET';
  const headers = {};
  let body;

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    switch (arg) {
      case '-X': case '--request':
        method = args[++i] || 'GET'; break;
      case '-H': case '--header': {
        const h = args[++i] || '';
        const ci = h.indexOf(':');
        if (ci > 0) headers[h.slice(0, ci).trim()] = h.slice(ci + 1).trim();
        break;
      }
      case '-d': case '--data': case '--data-raw':
        body = args[++i];
        if (method === 'GET') method = 'POST';
        break;
      case '-I': case '--head':
        method = 'HEAD'; break;
      case '-o': case '--output': case '-O': case '--remote-name':
        i++; break;
      default:
        if (!arg.startsWith('-')) url = arg;
        break;
    }
    i++;
  }
  return { url, method, headers, body };
}

function parseWgetArgs(args) {
  let url = '';
  const headers = {};
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === '--header') {
      const h = args[++i] || '';
      const ci = h.indexOf(':');
      if (ci > 0) headers[h.slice(0, ci).trim()] = h.slice(ci + 1).trim();
    } else if (arg === '-O' || arg === '--output-document') {
      i++;
    } else if (!arg.startsWith('-')) {
      url = arg;
    }
    i++;
  }
  return { url, method: 'GET', headers };
}

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

  let request;
  if (HTTP_COMMANDS.has(commandName)) {
    const parsed = commandName === 'curl' ? parseCurlArgs(args) : parseWgetArgs(args);
    if (!parsed.url) {
      process.stderr.write('Usage: ' + commandName + ' [options] <url>\\n');
      process.exit(1);
    }
    request = {
      jsonrpc: '2.0',
      id: 'shield-exec-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      method: 'http_request',
      params: {
        url: parsed.url,
        method: parsed.method,
        headers: parsed.headers,
        ...(parsed.body !== undefined ? { body: parsed.body } : {}),
      },
    };
  } else {
    request = {
      jsonrpc: '2.0',
      id: 'shield-exec-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      method: 'exec',
      params: { command: commandName, args },
    };
  }

  try {
    const response = await sendRequest(socketPath, request);
    if (response.error) {
      process.stderr.write('Error: ' + response.error.message + '\\n');
      process.exit(1);
    }
    const result = response.result;
    if (!result) { process.stderr.write('Error: Empty response\\n'); process.exit(1); }
    if (!result.success) {
      process.stderr.write('Error: ' + (result.error?.message || 'Unknown error') + '\\n');
      process.exit(1);
    }
    const data = result.data;
    if (!data) process.exit(0);
    if (request.method === 'http_request') {
      if (data.body) process.stdout.write(data.body);
      process.exit(0);
    }
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
