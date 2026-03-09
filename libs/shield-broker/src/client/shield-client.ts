#!/usr/bin/env node
/**
 * Shield Client CLI
 *
 * Command-line client for interacting with the broker daemon.
 */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

import { BrokerClient } from './broker-client.js';

const client = new BrokerClient({
  socketPath: process.env['AGENSHIELD_SOCKET'] || `${process.env['AGENSHIELD_USER_HOME'] || process.env['HOME'] || ''}/.agenshield/run/agenshield.sock`,
  httpHost: process.env['AGENSHIELD_HTTP_HOST'] || 'localhost',
  httpPort: parseInt(process.env['AGENSHIELD_HTTP_PORT'] || '5201', 10),
});

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  try {
    switch (command) {
      case 'ping':
        await handlePing(args.slice(1));
        break;

      case 'http':
        await handleHttp(args.slice(1));
        break;

      case 'file':
        await handleFile(args.slice(1));
        break;

      case 'exec':
        await handleExec(args.slice(1));
        break;

      case 'open':
        await handleOpen(args.slice(1));
        break;

      case 'secret':
        await handleSecret(args.slice(1));
        break;

      case 'check-exec':
        await handleCheckExec(args.slice(1));
        break;

      case 'check-pkg':
        await handleCheckPkg(args.slice(1));
        break;

      case 'skill':
        await handleSkill(args.slice(1));
        break;

      default:
        console.error(`Unknown command: ${command}`);
        printHelp();
        process.exit(1);
    }
  } catch (error) {
    console.error('Error:', (error as Error).message);
    process.exit(1);
  }
}

function printHelp(): void {
  console.log(`
Shield Client - AgenShield Broker CLI

Usage: shield-client <command> [options]

Commands:
  ping [message]                     Ping the broker
  http <method> <url> [body]         Make an HTTP request
  file read <path>                   Read a file
  file write <path> <content>        Write a file
  file list <path> [--recursive]     List directory contents
  exec <command> [args...]           Execute a command
  open <url>                         Open a URL in the browser
  secret get <name>                  Get a secret value
  check-exec <command>               Check if a command is allowed by policy
  check-pkg <manager> <package>      Check if a package install is allowed by policy
  skill run <name> [args...]         Run a skill with policy-enforced context

Environment:
  AGENSHIELD_SOCKET      Unix socket path (default: ~/.agenshield/run/agenshield.sock)
  AGENSHIELD_HTTP_HOST   HTTP fallback host (default: localhost)
  AGENSHIELD_HTTP_PORT   HTTP fallback port (default: 5201)

Examples:
  shield-client ping
  shield-client http GET https://api.example.com/data
  shield-client file read /path/to/file.txt
  shield-client exec ls -la
  shield-client open https://example.com
`);
}

async function handlePing(args: string[]): Promise<void> {
  const echo = args[0];
  const result = await client.ping(echo);
  console.log('Pong!');
  console.log(`  Version: ${result.version}`);
  console.log(`  Timestamp: ${result.timestamp}`);
  if (result.echo) {
    console.log(`  Echo: ${result.echo}`);
  }
}

async function handleHttp(args: string[]): Promise<void> {
  // Check for --raw flag (used by curl wrapper to get only the response body)
  const raw = args.includes('--raw');
  const filtered = raw ? args.filter((a) => a !== '--raw') : args;

  const method = filtered[0]?.toUpperCase() as 'GET' | 'POST' | 'PUT' | 'DELETE';
  const url = filtered[1];
  const body = filtered[2];

  if (!method || !url) {
    console.error('Usage: shield-client http [--raw] <method> <url> [body]');
    process.exit(1);
  }

  const result = await client.httpRequest({
    url,
    method,
    body,
  });

  if (raw) {
    // Raw mode: output only the response body (like real curl)
    if (result.body) process.stdout.write(result.body);
    if (!result.status || result.status >= 400) process.exit(22); // curl uses 22 for HTTP errors
    return;
  }

  console.log(`Status: ${result.status} ${result.statusText}`);
  console.log('Headers:');
  for (const [key, value] of Object.entries(result.headers)) {
    console.log(`  ${key}: ${value}`);
  }
  console.log('\nBody:');
  console.log(result.body);
}

async function handleFile(args: string[]): Promise<void> {
  const subcommand = args[0];

  switch (subcommand) {
    case 'read': {
      const path = args[1];
      if (!path) {
        console.error('Usage: shield-client file read <path>');
        process.exit(1);
      }
      const result = await client.fileRead({ path });
      console.log(result.content);
      break;
    }

    case 'write': {
      const path = args[1];
      const content = args.slice(2).join(' ');
      if (!path || !content) {
        console.error('Usage: shield-client file write <path> <content>');
        process.exit(1);
      }
      const result = await client.fileWrite({ path, content });
      console.log(`Wrote ${result.bytesWritten} bytes to ${result.path}`);
      break;
    }

    case 'list': {
      const path = args[1] || '.';
      const recursive = args.includes('--recursive') || args.includes('-r');
      const result = await client.fileList({ path, recursive });

      for (const entry of result.entries) {
        const typeChar = entry.type === 'directory' ? 'd' : entry.type === 'symlink' ? 'l' : '-';
        console.log(`${typeChar} ${entry.size.toString().padStart(10)} ${entry.name}`);
      }
      break;
    }

    default:
      console.error('Usage: shield-client file <read|write|list> [options]');
      process.exit(1);
  }
}

async function handleExec(args: string[]): Promise<void> {
  const command = args[0];
  const commandArgs = args.slice(1);

  if (!command) {
    console.error('Usage: shield-client exec <command> [args...]');
    process.exit(1);
  }

  const result = await client.exec({
    command,
    args: commandArgs,
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  process.exit(result.exitCode);
}

async function handleOpen(args: string[]): Promise<void> {
  const url = args[0];

  if (!url) {
    console.error('Usage: shield-client open <url>');
    process.exit(1);
  }

  const result = await client.openUrl({ url });
  console.log(result.opened ? 'URL opened successfully' : 'Failed to open URL');
}

async function handleSecret(args: string[]): Promise<void> {
  const subcommand = args[0];

  if (subcommand !== 'get') {
    console.error('Usage: shield-client secret get <name>');
    process.exit(1);
  }

  const name = args[1];
  if (!name) {
    console.error('Usage: shield-client secret get <name>');
    process.exit(1);
  }

  const result = await client.secretInject({ name });
  console.log(result.value);
}

async function handleCheckExec(args: string[]): Promise<void> {
  const target = args[0];

  if (!target) {
    console.error('Usage: shield-client check-exec <command>');
    process.exit(1);
  }

  const result = await client.policyCheck({ operation: 'exec', target });
  if (result.allowed) {
    process.exit(0);
  } else {
    process.exit(126); // "command cannot execute" convention
  }
}

async function handleCheckPkg(args: string[]): Promise<void> {
  const manager = args[0];
  const pkg = args[1];

  if (!manager || !pkg) {
    console.error('Usage: shield-client check-pkg <manager> <package>');
    process.exit(1);
  }

  const result = await client.policyCheck({
    operation: 'package_install' as import('@agenshield/ipc').OperationType,
    target: `${manager}:${pkg}`,
  });

  if (result.allowed) {
    process.exit(0);
  } else {
    process.exit(126); // "command cannot execute" convention
  }
}

async function handleSkill(args: string[]): Promise<void> {
  const subcommand = args[0];

  if (subcommand !== 'run') {
    console.error('Usage: shield-client skill run <name> [args...]');
    process.exit(1);
  }

  await handleSkillRun(args.slice(1));
}

async function handleSkillRun(args: string[]): Promise<void> {
  const slug = args[0];
  if (!slug) {
    console.error('Usage: shield-client skill run <name> [args...]');
    process.exit(1);
  }

  const remainingArgs = args.slice(1);
  const binaryPath = findSkillBinary(slug);

  if (!binaryPath) {
    console.error(`Error: Could not find binary for skill "${slug}"`);
    process.exit(1);
  }

  const child = spawn(binaryPath, remainingArgs, {
    stdio: 'inherit',
    env: {
      ...process.env,
      AGENSHIELD_CONTEXT_TYPE: 'skill',
      AGENSHIELD_SKILL_SLUG: slug,
    },
  });

  child.on('error', (err) => {
    console.error(`Error executing skill "${slug}": ${err.message}`);
    process.exit(1);
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
    } else {
      process.exit(code ?? 1);
    }
  });

  // Keep the process alive while the child runs
  await new Promise<void>(() => { /* keep alive */ });
}

/**
 * @deprecated Slug prefixes are no longer used. Kept for backward compat
 * to handle any lingering prefixed binaries during migration.
 */
const KNOWN_SLUG_PREFIXES = ['oc-', 'ch-', 'lo-', 'ag-', 'cb-'];

function stripKnownPrefix(slug: string): string | null {
  for (const prefix of KNOWN_SLUG_PREFIXES) {
    if (slug.startsWith(prefix) && slug.length > prefix.length) {
      return slug.slice(prefix.length);
    }
  }
  return null;
}

function findSkillBinary(slug: string): string | null {
  const agentHome = process.env['AGENSHIELD_AGENT_HOME'];
  if (!agentHome) return null;
  const wrapperDir = join(agentHome, 'bin');

  // 1. Check brew-originals directory first
  const brewOriginal = join(wrapperDir, '.brew-originals', slug);
  if (existsSync(brewOriginal)) {
    return brewOriginal;
  }

  // 2. Search PATH, excluding the wrapper directory to avoid infinite recursion
  const pathDirs = (process.env['PATH'] || '').split(':');
  for (const dir of pathDirs) {
    if (dir === wrapperDir) {
      continue;
    }
    const candidate = join(dir, slug);
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  // 3. Strip known prefix and retry (e.g. "oc-gog" → "gog")
  const rawName = stripKnownPrefix(slug);
  if (rawName) {
    const brewRaw = join(wrapperDir, '.brew-originals', rawName);
    if (existsSync(brewRaw)) {
      return brewRaw;
    }

    for (const dir of pathDirs) {
      if (dir === wrapperDir) continue;
      const candidate = join(dir, rawName);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
