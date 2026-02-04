#!/usr/bin/env node
/**
 * Shield Client CLI
 *
 * Command-line client for interacting with the broker daemon.
 */

import { BrokerClient } from './broker-client.js';

const client = new BrokerClient({
  socketPath: process.env['AGENSHIELD_SOCKET'] || '/var/run/agenshield.sock',
  httpHost: process.env['AGENSHIELD_HTTP_HOST'] || 'localhost',
  httpPort: parseInt(process.env['AGENSHIELD_HTTP_PORT'] || '6969', 10),
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

Environment:
  AGENSHIELD_SOCKET      Unix socket path (default: /var/run/agenshield.sock)
  AGENSHIELD_HTTP_HOST   HTTP fallback host (default: localhost)
  AGENSHIELD_HTTP_PORT   HTTP fallback port (default: 6969)

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
  const method = args[0]?.toUpperCase() as 'GET' | 'POST' | 'PUT' | 'DELETE';
  const url = args[1];
  const body = args[2];

  if (!method || !url) {
    console.error('Usage: shield-client http <method> <url> [body]');
    process.exit(1);
  }

  const result = await client.httpRequest({
    url,
    method,
    body,
  });

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

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
