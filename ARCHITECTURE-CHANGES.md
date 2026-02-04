# AgenShield Architecture Changes

This document outlines the architectural changes required to support enhanced security features including Node.js-level command interception, native response format preservation, secret redaction, AgentLink integration, and skills approval workflow.

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [PATH Bin Proxies & Secret Reference Tokens](#1-path-bin-proxies--secret-reference-tokens)
3. [Command Interception at Node.js Level](#2-command-interception-at-nodejs-level)
4. [Native Response Format Preservation](#3-native-response-format-preservation)
5. [Env Variable Redaction from Responses](#4-env-variable-redaction-from-responses)
6. [AgentLink Integration into AgenShield](#5-agentlink-integration-into-agenshield)
7. [Skills Folder Watching & Approval Workflow](#6-skills-folder-watching--approval-workflow)
8. [Migration Path](#migration-path)
9. [API Changes](#api-changes)
10. [Security Considerations](#security-considerations)

---

## Executive Summary

AgenShield requires six major architectural changes to enhance security and functionality:

| Change | Purpose | Impact |
|--------|---------|--------|
| PATH Bin Proxies & Secret Refs | Node.js bin proxies in PATH, JSON-RPC to daemon, secret ref tokens in env | New `libs/shield-bins/` package |
| Node.js Preload Interception | Catch HTTP commands before execution to inject secrets | New package `@agenshield/preload` |
| Response Format Preservation | Return responses in native tool format (curl, wget, etc.) | New formatters module |
| Secret Redaction | Prevent injected secrets from leaking in responses | New redaction layer |
| AgentLink Centralization | Move AgentLink from skill to core daemon functionality | Refactor existing code |
| Skills Approval Workflow | Runtime monitoring and approval of new skills | New watcher + routes |

```mermaid
graph TB
    subgraph "Current Architecture"
        A1[Agent Process] --> B1[Bash Wrapper]
        B1 --> C1[shield-client binary]
        C1 --> D1[Daemon Broker]
    end

    subgraph "New Architecture"
        A2[Agent Process + Preload] --> B2[Bin Proxy in PATH]
        B2 --> C2{Scan for __AGENSHIELD_REF_ prefix}
        C2 -->|Refs found| D2[JSON-RPC to Daemon]
        D2 --> E2[Daemon resolves refs to real secrets]
        E2 --> F2[Execute native command with real values]
        F2 --> G2[Capture response]
        G2 --> H2[Redact secrets from output]
        H2 --> I2[Native format response]
        C2 -->|No refs| J2[Pass through to real binary]
    end
```

---

## 1. PATH Bin Proxies & Secret Reference Tokens

This is the foundational mechanism that all other interception features depend on. It defines how commands are proxied and how the agent references secrets it doesn't have direct access to.

### Core Problem

When OpenClaw (the agent) needs to call an API with a secret:

```bash
curl http://my-good-service.com -H "Authorization: Bearer $MY_API_KEY"
```

The agent doesn't have the real secret value. We need a mechanism where:
1. The agent can **reference** secrets by name using standard env var syntax
2. The interception layer can **detect** which values are secret references
3. The daemon can **resolve** references to real values at execution time
4. The agent **never sees** the real secret value

### Secret Reference Token Design

When an admin registers a secret in the AgenShield daemon, the system generates a **reference token** with a well-known prefix and stores a mapping:

```
Prefix:  __AGENSHIELD_REF_
Format:  __AGENSHIELD_REF_<random_hex_16>
Example: __AGENSHIELD_REF_7f3a9b2ce41d08a6
```

The daemon then injects the reference token into the agent's environment as the named variable:

```bash
# Agent's environment (set by daemon at process start)
MY_API_KEY=__AGENSHIELD_REF_7f3a9b2ce41d08a6
SLACK_TOKEN=__AGENSHIELD_REF_e92b4a1f3c5d7890
DATABASE_URL=__AGENSHIELD_REF_1a2b3c4d5e6f7890
```

The agent uses these env vars naturally. When the shell expands `$MY_API_KEY`, it becomes the ref token - not the real secret.

### Secret Registration Flow

```mermaid
sequenceDiagram
    participant Admin as Admin (Dashboard/CLI)
    participant Daemon as AgenShield Daemon
    participant Vault as Secret Vault
    participant Env as Agent Environment

    Admin->>Daemon: POST /api/secrets {name: "MY_API_KEY", value: "sk-abc123"}
    Daemon->>Daemon: Generate ref: __AGENSHIELD_REF_7f3a9b2ce41d08a6
    Daemon->>Vault: Store mapping: ref → "sk-abc123"
    Daemon->>Env: Set MY_API_KEY=__AGENSHIELD_REF_7f3a9b2ce41d08a6
    Daemon-->>Admin: {name: "MY_API_KEY", ref: "__AGENSHIELD_REF_7f3a...", status: "active"}
```

### Secret Resolution Flow (at Command Execution)

```mermaid
sequenceDiagram
    participant Agent as OpenClaw Agent
    participant Shell as Shell Expansion
    participant Bin as curl (bin proxy)
    participant Daemon as AgenShield Daemon
    participant Real as /usr/bin/curl (real)

    Agent->>Shell: curl -H "Authorization: Bearer $MY_API_KEY" https://api.example.com
    Shell->>Bin: curl -H "Authorization: Bearer __AGENSHIELD_REF_7f3a9b2ce41d08a6" https://api.example.com

    Note over Bin: Scan args for __AGENSHIELD_REF_ prefix

    Bin->>Daemon: JSON-RPC: resolve_and_execute
    Note over Bin,Daemon: {command: "curl", args: [...],<br/>refs: ["__AGENSHIELD_REF_7f3a9b2ce41d08a6"]}

    Daemon->>Daemon: Resolve refs to real values
    Daemon->>Real: Execute: curl -H "Authorization: Bearer sk-abc123" https://api.example.com
    Real-->>Daemon: Response (may contain secret in headers)
    Daemon->>Daemon: Redact secret values from response
    Daemon-->>Bin: {stdout: "...(redacted)...", exitCode: 0}
    Bin-->>Agent: Redacted response in native curl format
```

### Bin Proxy Architecture

Every intercepted command (`curl`, `wget`, `git`, etc.) gets a **Node.js bin proxy** placed in a directory that is prepended to the agent's `PATH`. These are NOT bash wrappers - they are proper Node.js scripts that communicate with the daemon via JSON-RPC.

#### PATH Setup

```bash
# Daemon prepends the proxy bin directory to agent's PATH
PATH=/var/lib/agenshield/bins:$ORIGINAL_PATH

# Contents of /var/lib/agenshield/bins/
/var/lib/agenshield/bins/
├── curl          # → Node.js proxy
├── wget          # → Node.js proxy
├── git           # → Node.js proxy
├── ssh           # → Node.js proxy
├── agentlink     # → Node.js proxy
└── .real-paths   # JSON map of original binary locations
```

#### Bin Proxy Template

Every bin proxy follows the same pattern - a thin Node.js script that forwards to the daemon via JSON-RPC:

```javascript
#!/usr/bin/env node

// Auto-generated bin proxy for: curl
// All logic lives in the daemon. This is a thin JSON-RPC client.

const net = require('net');
const path = require('path');

const COMMAND_NAME = path.basename(process.argv[1]);
const ARGS = process.argv.slice(2);
const DAEMON_SOCKET = process.env.AGENSHIELD_SOCKET || '/var/run/agenshield/daemon.sock';
const REF_PREFIX = '__AGENSHIELD_REF_';

// Detect if any argument contains a secret reference
function containsSecretRefs(args) {
  return args.some(arg => arg.includes(REF_PREFIX));
}

// Extract all secret refs from arguments
function extractRefs(args) {
  const refs = [];
  const refPattern = new RegExp(`${REF_PREFIX}[a-f0-9]{16}`, 'g');
  for (const arg of args) {
    const matches = arg.match(refPattern);
    if (matches) refs.push(...matches);
  }
  return [...new Set(refs)]; // deduplicate
}

// Send JSON-RPC request to daemon over Unix socket
function sendJsonRpc(method, params) {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(DAEMON_SOCKET, () => {
      const request = JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        params
      });
      client.write(request + '\n');
    });

    let data = '';
    client.on('data', (chunk) => { data += chunk; });
    client.on('end', () => {
      try {
        const response = JSON.parse(data);
        if (response.error) {
          reject(new Error(response.error.message));
        } else {
          resolve(response.result);
        }
      } catch (e) {
        reject(new Error(`Invalid daemon response: ${data}`));
      }
    });
    client.on('error', reject);
  });
}

async function main() {
  const hasRefs = containsSecretRefs(ARGS);

  if (!hasRefs) {
    // No secret references found - fast path: exec the real binary directly
    // This avoids daemon overhead for commands that don't use secrets
    const { execFileSync } = require('child_process');
    const realPaths = require('/var/lib/agenshield/bins/.real-paths.json');
    const realBin = realPaths[COMMAND_NAME];

    if (!realBin) {
      console.error(`[AgenShield] Real binary not found for: ${COMMAND_NAME}`);
      process.exit(127);
    }

    try {
      const result = execFileSync(realBin, ARGS, {
        stdio: 'inherit',
        env: process.env
      });
      process.exit(0);
    } catch (error) {
      process.exit(error.status || 1);
    }
  }

  // Secret references detected - route through daemon
  const refs = extractRefs(ARGS);

  try {
    const result = await sendJsonRpc('command.execute', {
      command: COMMAND_NAME,
      args: ARGS,
      refs: refs,
      cwd: process.cwd(),
      env: {
        // Pass through select env vars the command may need
        HOME: process.env.HOME,
        USER: process.env.USER,
        TERM: process.env.TERM,
      },
      // Tell daemon which flags are present (for response formatting)
      flags: ARGS.filter(a => a.startsWith('-'))
    });

    // Write output exactly as the real command would
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exit(result.exitCode || 0);

  } catch (error) {
    console.error(`[AgenShield] Proxy error: ${error.message}`);
    process.exit(1);
  }
}

main();
```

#### Daemon JSON-RPC Handler

The daemon receives the `command.execute` JSON-RPC call, resolves secret refs, runs the real command, and redacts the output:

```typescript
// libs/shield-daemon/src/rpc/handlers/command-execute.ts

import { spawn } from 'child_process';
import { SecretVault } from '../../services/secret-vault';
import { redactString, createRedactionContext } from '../../redaction';
import { getFormatter } from '../../formatters';

interface CommandExecuteParams {
  command: string;       // "curl"
  args: string[];        // ["-H", "Authorization: Bearer __AGENSHIELD_REF_7f3a...", "https://..."]
  refs: string[];        // ["__AGENSHIELD_REF_7f3a9b2ce41d08a6"]
  cwd: string;
  env: Record<string, string>;
  flags: string[];
}

interface CommandExecuteResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function handleCommandExecute(
  params: CommandExecuteParams,
  vault: SecretVault,
  realPaths: Record<string, string>
): Promise<CommandExecuteResult> {

  // 1. Resolve all secret references to real values
  const resolvedSecrets: Map<string, string> = new Map();
  for (const ref of params.refs) {
    const secret = await vault.resolveRef(ref);
    if (secret) {
      resolvedSecrets.set(ref, secret.value);
    }
  }

  // 2. Replace refs in args with real values
  const resolvedArgs = params.args.map(arg => {
    let resolved = arg;
    for (const [ref, value] of resolvedSecrets) {
      resolved = resolved.split(ref).join(value);
    }
    return resolved;
  });

  // 3. Execute the real binary
  const realBin = realPaths[params.command];
  if (!realBin) {
    return { stdout: '', stderr: `Unknown command: ${params.command}`, exitCode: 127 };
  }

  const { stdout, stderr, exitCode } = await executeCommand(
    realBin,
    resolvedArgs,
    params.cwd,
    params.env
  );

  // 4. Redact real secret values from output
  const redactionCtx = createRedactionContext(
    Object.fromEntries(resolvedSecrets)
  );

  const redactedStdout = redactString(stdout, redactionCtx);
  const redactedStderr = redactString(stderr, redactionCtx);

  // 5. Format response to match native command output
  const formatter = getFormatter(params.command);
  // (formatter may adjust output based on flags like -i, -v, etc.)

  return {
    stdout: redactedStdout,
    stderr: redactedStderr,
    exitCode
  };
}

function executeCommand(
  bin: string, args: string[], cwd: string, env: Record<string, string>
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn(bin, args, { cwd, env: { ...process.env, ...env } });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => { stdout += d; });
    proc.stderr.on('data', (d) => { stderr += d; });
    proc.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
  });
}
```

### Secret Vault Schema

```typescript
// libs/shield-daemon/src/services/secret-vault.ts

interface StoredSecret {
  name: string;           // "MY_API_KEY" - the env var name the agent sees
  ref: string;            // "__AGENSHIELD_REF_7f3a9b2ce41d08a6" - the reference token
  encryptedValue: string; // Encrypted real value
  createdAt: Date;
  createdBy: string;      // Admin who registered it
  lastUsed?: Date;
  usageCount: number;
}

export class SecretVault {
  private secrets: Map<string, StoredSecret> = new Map(); // ref -> secret

  async registerSecret(name: string, value: string, createdBy: string): Promise<string> {
    const ref = this.generateRef();
    const encrypted = await this.encrypt(value);

    this.secrets.set(ref, {
      name,
      ref,
      encryptedValue: encrypted,
      createdAt: new Date(),
      createdBy,
      usageCount: 0
    });

    return ref;
  }

  async resolveRef(ref: string): Promise<{ name: string; value: string } | null> {
    const secret = this.secrets.get(ref);
    if (!secret) return null;

    secret.lastUsed = new Date();
    secret.usageCount++;

    const value = await this.decrypt(secret.encryptedValue);
    return { name: secret.name, value };
  }

  async revokeSecret(ref: string): Promise<boolean> {
    return this.secrets.delete(ref);
  }

  async listSecrets(): Promise<Array<{ name: string; ref: string; createdAt: Date; usageCount: number }>> {
    return Array.from(this.secrets.values()).map(s => ({
      name: s.name,
      ref: s.ref,
      createdAt: s.createdAt,
      usageCount: s.usageCount
    }));
    // Note: Never returns the actual value
  }

  private generateRef(): string {
    const crypto = require('crypto');
    const random = crypto.randomBytes(8).toString('hex'); // 16 hex chars
    return `__AGENSHIELD_REF_${random}`;
  }

  private async encrypt(value: string): Promise<string> {
    // Uses daemon's master encryption key
    // Implementation depends on chosen crypto strategy
    throw new Error('TODO: implement encryption');
  }

  private async decrypt(encrypted: string): Promise<string> {
    throw new Error('TODO: implement decryption');
  }
}
```

### Bin Proxy Generation

Rather than hand-writing each proxy, the daemon generates them from a template:

```typescript
// libs/shield-daemon/src/services/bin-generator.ts

import * as fs from 'fs/promises';
import * as path from 'path';
import { execSync } from 'child_process';

const PROXY_BIN_DIR = '/var/lib/agenshield/bins';

// Commands that get bin proxies
const PROXIED_COMMANDS = [
  'curl', 'wget', 'git', 'ssh', 'scp', 'rsync',
  'http',   // httpie
  'agentlink'
];

export async function generateBinProxies(): Promise<void> {
  await fs.mkdir(PROXY_BIN_DIR, { recursive: true });

  // Discover real binary paths
  const realPaths: Record<string, string> = {};
  for (const cmd of PROXIED_COMMANDS) {
    try {
      const realPath = execSync(`which ${cmd} 2>/dev/null`, {
        env: { PATH: getSystemPath() }
      }).toString().trim();
      if (realPath) realPaths[cmd] = realPath;
    } catch {
      // Command not installed, skip
    }
  }

  // Write real paths map
  await fs.writeFile(
    path.join(PROXY_BIN_DIR, '.real-paths.json'),
    JSON.stringify(realPaths, null, 2)
  );

  // Generate proxy for each command
  for (const cmd of Object.keys(realPaths)) {
    const proxyScript = generateProxyScript(cmd);
    const proxyPath = path.join(PROXY_BIN_DIR, cmd);
    await fs.writeFile(proxyPath, proxyScript, { mode: 0o755 });
  }
}

function getSystemPath(): string {
  // Return PATH without our proxy dir to find real binaries
  return (process.env.PATH || '')
    .split(':')
    .filter(p => p !== PROXY_BIN_DIR)
    .join(':');
}

function generateProxyScript(commandName: string): string {
  return `#!/usr/bin/env node
// Auto-generated AgenShield bin proxy for: ${commandName}
// DO NOT EDIT - regenerated by daemon on startup

const net = require('net');
const path = require('path');
const { execFileSync } = require('child_process');

const CMD = '${commandName}';
const ARGS = process.argv.slice(2);
const SOCKET = process.env.AGENSHIELD_SOCKET || '/var/run/agenshield/daemon.sock';
const REF_PREFIX = '__AGENSHIELD_REF_';
const REF_PATTERN = new RegExp(REF_PREFIX + '[a-f0-9]{16}', 'g');

function hasRefs(args) {
  return args.some(a => a.includes(REF_PREFIX));
}

function extractRefs(args) {
  const refs = new Set();
  for (const arg of args) {
    const m = arg.match(REF_PATTERN);
    if (m) m.forEach(r => refs.add(r));
  }
  return [...refs];
}

function rpc(method, params) {
  return new Promise((resolve, reject) => {
    const c = net.createConnection(SOCKET, () => {
      c.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) + '\\n');
    });
    let d = '';
    c.on('data', chunk => d += chunk);
    c.on('end', () => {
      try {
        const r = JSON.parse(d);
        r.error ? reject(new Error(r.error.message)) : resolve(r.result);
      } catch (e) { reject(e); }
    });
    c.on('error', reject);
  });
}

async function main() {
  if (!hasRefs(ARGS)) {
    // Fast path: no secrets, exec real binary directly
    try {
      const paths = require('${PROXY_BIN_DIR}/.real-paths.json');
      execFileSync(paths[CMD], ARGS, { stdio: 'inherit' });
      process.exit(0);
    } catch (e) { process.exit(e.status || 1); }
  }

  try {
    const result = await rpc('command.execute', {
      command: CMD,
      args: ARGS,
      refs: extractRefs(ARGS),
      cwd: process.cwd(),
      flags: ARGS.filter(a => a.startsWith('-'))
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exit(result.exitCode || 0);
  } catch (e) {
    process.stderr.write('[AgenShield] ' + e.message + '\\n');
    process.exit(1);
  }
}

main();
`;
}
```

### Daemon API for Secret Management

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/secrets` | Register a new secret (returns ref token) |
| GET | `/api/secrets` | List secrets (names + refs, never values) |
| DELETE | `/api/secrets/:ref` | Revoke a secret |
| POST | `/api/secrets/:ref/rotate` | Rotate secret value (same ref, new value) |

```typescript
// Example: Registering a secret
// POST /api/secrets
// Body: { "name": "MY_API_KEY", "value": "sk-abc123" }
// Response: {
//   "name": "MY_API_KEY",
//   "ref": "__AGENSHIELD_REF_7f3a9b2ce41d08a6",
//   "envVar": "MY_API_KEY=__AGENSHIELD_REF_7f3a9b2ce41d08a6",
//   "status": "active"
// }
```

### Why Reference Tokens (Not Direct Injection)

| Approach | Problem |
|----------|---------|
| Inject real secrets into env | Agent process can read `/proc/self/environ` or `env` command and exfiltrate them |
| Encrypt secrets in env | Agent needs decryption key, same problem |
| No env vars at all | Agent can't reference secrets in commands, breaks natural shell usage |
| **Reference tokens** | Agent sees meaningless tokens, real values only exist inside daemon memory, shell expansion works naturally |

### End-to-End Example

```bash
# 1. Admin registers a secret
$ agenshield secrets add MY_API_KEY "sk-live-abc123def456"
# → Secret registered: MY_API_KEY = __AGENSHIELD_REF_7f3a9b2ce41d08a6

# 2. Agent's environment now contains:
# MY_API_KEY=__AGENSHIELD_REF_7f3a9b2ce41d08a6

# 3. OpenClaw generates a curl command:
curl https://api.example.com/data -H "Authorization: Bearer $MY_API_KEY"

# 4. Shell expands to:
curl https://api.example.com/data -H "Authorization: Bearer __AGENSHIELD_REF_7f3a9b2ce41d08a6"

# 5. Bin proxy (our curl) detects __AGENSHIELD_REF_ prefix
# 6. Sends JSON-RPC to daemon with the refs
# 7. Daemon resolves: __AGENSHIELD_REF_7f3a9b2ce41d08a6 → "sk-live-abc123def456"
# 8. Daemon executes real curl with real secret
# 9. Daemon redacts "sk-live-abc123def456" from response
# 10. Agent receives clean response - never sees the real secret
```

### Files to Create

- `libs/shield-daemon/src/services/secret-vault.ts` - Secret storage and ref resolution
- `libs/shield-daemon/src/services/bin-generator.ts` - Proxy binary generation
- `libs/shield-daemon/src/rpc/handlers/command-execute.ts` - JSON-RPC handler
- `libs/shield-daemon/src/rpc/server.ts` - Unix socket JSON-RPC server
- `libs/shield-daemon/src/routes/secrets.ts` - Secret management REST API

### Files to Modify

- `libs/shield-daemon/src/daemon.ts` - Start JSON-RPC server, generate bins on startup
- `libs/shield-sandbox/src/environment.ts` - Prepend proxy bin dir to PATH, inject ref env vars
- `libs/shield-daemon/src/config/defaults.ts` - Add bin proxy and secret vault config

---

## 2. Command Interception at Node.js Level

### Current State

- Bash wrappers in `libs/shield-sandbox/src/wrappers.ts` intercept `curl`, `wget`, etc.
- Wrappers call `shield-client http` binary
- Response printed in custom format:
  ```
  Status: 200 OK
  Headers:
    content-type: application/json
  Body:
  {...}
  ```

### Problem

- Wrapper approach requires PATH manipulation
- Cannot intercept programmatic HTTP calls (fetch, http module)
- Response format doesn't match native tool output

### Required Change

OpenClaw's Node.js process must intercept commands BEFORE they execute:
1. Check if command requires env variable injection (from AgenShield secrets)
2. If yes: inject env vars and execute with those variables
3. If no: pass through normally

### New Flow (AgenShield Preload Approach)

```mermaid
sequenceDiagram
    participant OC as OpenClaw
    participant PL as @agenshield/preload
    participant CP as child_process (patched)
    participant BR as AgenShield Broker
    participant CMD as Actual curl/wget

    OC->>PL: node --require @agenshield/preload ...
    PL->>CP: Patch spawn/exec/execSync

    Note over OC: Agent calls curl
    OC->>CP: spawn('curl', [...args])
    CP->>BR: Check for required env vars
    BR-->>CP: Return secrets map
    CP->>CMD: Execute with injected env
    CMD-->>CP: Raw response
    CP->>CP: Capture & redact secrets
    CP-->>OC: Native format response
```

### Files to Create

#### `libs/shield-preload/package.json`

```json
{
  "name": "@agenshield/preload",
  "version": "0.1.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  },
  "dependencies": {
    "@agenshield/common": "workspace:*"
  }
}
```

#### `libs/shield-preload/src/index.ts`

Main preload entry point that patches all relevant modules.

```typescript
import { patchChildProcess } from './patches/child-process';
import { patchFetch } from './patches/fetch';
import { patchHttp } from './patches/http';

// Initialize preload patches
function init() {
  patchChildProcess();
  patchFetch();
  patchHttp();

  console.log('[AgenShield] Preload initialized');
}

init();
```

#### `libs/shield-preload/src/patches/child-process.ts`

Patches `spawn`, `exec`, `execSync` to intercept HTTP commands.

```typescript
import * as childProcess from 'child_process';
import { getSecretsForCommand, redactSecrets } from '../secrets';
import { formatResponse } from '../formatters';

const originalSpawn = childProcess.spawn;
const originalExec = childProcess.exec;
const originalExecSync = childProcess.execSync;

const HTTP_COMMANDS = ['curl', 'wget', 'http', 'https'];

function isHttpCommand(command: string): boolean {
  const cmd = command.split('/').pop()?.split(' ')[0] || '';
  return HTTP_COMMANDS.includes(cmd);
}

export function patchChildProcess() {
  // Patch spawn
  (childProcess as any).spawn = function patchedSpawn(
    command: string,
    args?: string[],
    options?: childProcess.SpawnOptions
  ) {
    if (isHttpCommand(command)) {
      const secrets = getSecretsForCommand(command, args || []);
      const patchedOptions = {
        ...options,
        env: { ...process.env, ...options?.env, ...secrets }
      };
      return originalSpawn.call(this, command, args, patchedOptions);
    }
    return originalSpawn.call(this, command, args, options);
  };

  // Patch exec
  (childProcess as any).exec = function patchedExec(
    command: string,
    options?: any,
    callback?: any
  ) {
    if (isHttpCommand(command)) {
      const secrets = getSecretsForCommand(command, []);
      const patchedOptions = typeof options === 'object'
        ? { ...options, env: { ...process.env, ...options?.env, ...secrets } }
        : options;
      return originalExec.call(this, command, patchedOptions, callback);
    }
    return originalExec.call(this, command, options, callback);
  };

  // Patch execSync
  (childProcess as any).execSync = function patchedExecSync(
    command: string,
    options?: childProcess.ExecSyncOptions
  ) {
    if (isHttpCommand(command)) {
      const secrets = getSecretsForCommand(command, []);
      const patchedOptions = {
        ...options,
        env: { ...process.env, ...options?.env, ...secrets }
      };
      const result = originalExecSync.call(this, command, patchedOptions);
      return redactSecrets(result, secrets);
    }
    return originalExecSync.call(this, command, options);
  };
}
```

#### `libs/shield-preload/src/patches/fetch.ts`

Patches `globalThis.fetch` for programmatic HTTP calls.

```typescript
import { getSecretsForUrl, redactSecrets } from '../secrets';

const originalFetch = globalThis.fetch;

export function patchFetch() {
  globalThis.fetch = async function patchedFetch(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    const url = typeof input === 'string' ? input : input.toString();
    const secrets = getSecretsForUrl(url);

    // Inject secrets into headers
    const headers = new Headers(init?.headers);
    for (const [key, value] of Object.entries(secrets)) {
      if (key.startsWith('HEADER_')) {
        const headerName = key.replace('HEADER_', '').replace(/_/g, '-');
        headers.set(headerName, value);
      }
    }

    const response = await originalFetch.call(this, input, {
      ...init,
      headers
    });

    // Return response with redaction wrapper
    return new Proxy(response, {
      get(target, prop) {
        if (prop === 'text') {
          return async () => {
            const text = await target.text();
            return redactSecrets(text, secrets);
          };
        }
        if (prop === 'json') {
          return async () => {
            const text = await target.text();
            return JSON.parse(redactSecrets(text, secrets));
          };
        }
        return Reflect.get(target, prop);
      }
    });
  };
}
```

#### `libs/shield-preload/src/patches/http.ts`

Patches Node.js `http` and `https` modules.

```typescript
import * as http from 'http';
import * as https from 'https';
import { getSecretsForUrl, redactSecrets } from '../secrets';

function patchModule(mod: typeof http | typeof https) {
  const originalRequest = mod.request;

  (mod as any).request = function patchedRequest(
    url: string | URL | http.RequestOptions,
    options?: http.RequestOptions | ((res: http.IncomingMessage) => void),
    callback?: (res: http.IncomingMessage) => void
  ) {
    // Extract URL for secret lookup
    let targetUrl: string;
    if (typeof url === 'string') {
      targetUrl = url;
    } else if (url instanceof URL) {
      targetUrl = url.toString();
    } else {
      targetUrl = `${url.protocol || 'http:'}//${url.hostname}${url.path || '/'}`;
    }

    const secrets = getSecretsForUrl(targetUrl);

    // Inject secrets into headers
    if (typeof options === 'object' && options !== null) {
      options.headers = { ...options.headers };
      for (const [key, value] of Object.entries(secrets)) {
        if (key.startsWith('HEADER_')) {
          const headerName = key.replace('HEADER_', '').replace(/_/g, '-');
          options.headers[headerName] = value;
        }
      }
    }

    return originalRequest.call(this, url, options as any, callback);
  };
}

export function patchHttp() {
  patchModule(http);
  patchModule(https);
}
```

### Directory Structure

```
libs/shield-preload/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts
│   ├── secrets.ts
│   ├── formatters/
│   │   ├── index.ts
│   │   ├── curl.ts
│   │   ├── wget.ts
│   │   └── fetch.ts
│   └── patches/
│       ├── child-process.ts
│       ├── fetch.ts
│       └── http.ts
```

---

## 3. Native Response Format Preservation

### Current State

`libs/shield-broker/src/client/shield-client.ts` formats responses as:

```
Status: 200 OK
Headers:
  content-type: application/json
Body:
{...}
```

This is NOT how `curl -i` or `curl -v` format responses.

### Required Change

Response formatter must match the ORIGINAL command's output format:

| Command | Format |
|---------|--------|
| `curl` (no flags) | Just body |
| `curl -i` | `HTTP/1.1 200 OK\r\nHeaders...\r\n\r\n{body}` |
| `curl -I` | Headers only |
| `curl -v` | Verbose with request/response details |
| `wget` | Body to file, status to stderr |
| `fetch` | Response object structure |

### Architecture

```mermaid
classDiagram
    class ResponseFormatter {
        <<interface>>
        +format(result: HttpRequestResult, cmd: string, flags: string[]): string
    }

    class CurlResponseFormatter {
        +format(result, cmd, flags): string
        -formatVerbose(result): string
        -formatHeaders(headers): string
    }

    class WgetResponseFormatter {
        +format(result, cmd, flags): string
    }

    class FetchResponseFormatter {
        +format(result, cmd, flags): string
    }

    ResponseFormatter <|.. CurlResponseFormatter
    ResponseFormatter <|.. WgetResponseFormatter
    ResponseFormatter <|.. FetchResponseFormatter
```

### Files to Create

#### `libs/shield-interceptor/src/formatters/index.ts`

```typescript
import { HttpRequestResult } from '@agenshield/common';
import { CurlResponseFormatter } from './curl';
import { WgetResponseFormatter } from './wget';
import { FetchResponseFormatter } from './fetch';

export interface ResponseFormatter {
  format(result: HttpRequestResult, originalCommand: string, flags: string[]): string;
}

const formatters: Record<string, ResponseFormatter> = {
  curl: new CurlResponseFormatter(),
  wget: new WgetResponseFormatter(),
  fetch: new FetchResponseFormatter(),
};

export function getFormatter(command: string): ResponseFormatter {
  const cmd = command.split('/').pop() || command;
  return formatters[cmd] || formatters.curl; // Default to curl format
}

export function formatResponse(
  result: HttpRequestResult,
  command: string,
  flags: string[]
): string {
  const formatter = getFormatter(command);
  return formatter.format(result, command, flags);
}
```

#### `libs/shield-interceptor/src/formatters/curl.ts`

```typescript
import { HttpRequestResult } from '@agenshield/common';
import { ResponseFormatter } from './index';

export class CurlResponseFormatter implements ResponseFormatter {
  format(result: HttpRequestResult, cmd: string, flags: string[]): string {
    const hasInclude = flags.some(f => f === '-i' || f === '--include');
    const hasHead = flags.some(f => f === '-I' || f === '--head');
    const hasVerbose = flags.some(f => f === '-v' || f === '--verbose');

    if (hasVerbose) {
      return this.formatVerbose(result);
    }

    if (hasHead) {
      return this.formatHeadersOnly(result);
    }

    if (hasInclude) {
      return this.formatWithHeaders(result);
    }

    // Default: body only
    return result.body;
  }

  private formatHeadersOnly(result: HttpRequestResult): string {
    const statusLine = `HTTP/1.1 ${result.status} ${result.statusText}`;
    const headers = this.formatHeaders(result.headers);
    return `${statusLine}\r\n${headers}\r\n`;
  }

  private formatWithHeaders(result: HttpRequestResult): string {
    const statusLine = `HTTP/1.1 ${result.status} ${result.statusText}`;
    const headers = this.formatHeaders(result.headers);
    return `${statusLine}\r\n${headers}\r\n\r\n${result.body}`;
  }

  private formatVerbose(result: HttpRequestResult): string {
    const lines: string[] = [];

    // Response info
    lines.push(`< HTTP/1.1 ${result.status} ${result.statusText}`);

    // Response headers
    for (const [key, value] of Object.entries(result.headers)) {
      lines.push(`< ${key}: ${value}`);
    }

    lines.push('<');

    // Body
    if (result.body) {
      lines.push(result.body);
    }

    return lines.join('\r\n');
  }

  private formatHeaders(headers: Record<string, string>): string {
    return Object.entries(headers)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\r\n');
  }
}
```

#### `libs/shield-interceptor/src/formatters/wget.ts`

```typescript
import { HttpRequestResult } from '@agenshield/common';
import { ResponseFormatter } from './index';

export class WgetResponseFormatter implements ResponseFormatter {
  format(result: HttpRequestResult, cmd: string, flags: string[]): string {
    const hasQuiet = flags.some(f => f === '-q' || f === '--quiet');
    const hasOutputDoc = flags.some(f => f === '-O' || f === '--output-document');

    if (hasQuiet) {
      return result.body;
    }

    // wget typically outputs progress to stderr and body to stdout/file
    // For interception purposes, we return body
    const statusInfo = `--${new Date().toISOString()}--  ${result.url || 'request'}\n`;
    const responseInfo = `HTTP request sent, awaiting response... ${result.status} ${result.statusText}\n`;
    const lengthInfo = result.headers['content-length']
      ? `Length: ${result.headers['content-length']} [${result.headers['content-type'] || 'application/octet-stream'}]\n`
      : `Length: unspecified [${result.headers['content-type'] || 'application/octet-stream'}]\n`;

    if (hasOutputDoc) {
      return result.body;
    }

    return `${statusInfo}${responseInfo}${lengthInfo}\n${result.body}`;
  }
}
```

#### `libs/shield-interceptor/src/formatters/fetch.ts`

```typescript
import { HttpRequestResult } from '@agenshield/common';
import { ResponseFormatter } from './index';

export class FetchResponseFormatter implements ResponseFormatter {
  format(result: HttpRequestResult, cmd: string, flags: string[]): string {
    // For programmatic fetch, return JSON representation
    // that can be reconstructed into a Response-like object
    return JSON.stringify({
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      statusText: result.statusText,
      headers: result.headers,
      body: result.body,
      url: result.url || '',
    });
  }
}
```

---

## 4. Env Variable Redaction from Responses

### Current State

- No redaction of sensitive values from response headers
- If a secret is injected as `Authorization: Bearer xxx`, it could leak in response headers

### Required Change

Before returning any response:
1. Scan headers AND body for injected env variable values
2. Replace sensitive values with `[REDACTED]` or `[VAR_NAME:REDACTED]`
3. Track which env vars were injected for this request

### Implementation

#### `libs/shield-interceptor/src/redaction.ts`

```typescript
import { HttpRequestResult } from '@agenshield/common';

export interface RedactionContext {
  injectedSecrets: Map<string, string>; // name -> value
}

export interface RedactionOptions {
  redactBody?: boolean;      // Default: true
  redactHeaders?: boolean;   // Default: true
  redactionFormat?: 'name' | 'generic'; // '[SECRET_NAME:REDACTED]' vs '[REDACTED]'
}

const DEFAULT_OPTIONS: RedactionOptions = {
  redactBody: true,
  redactHeaders: true,
  redactionFormat: 'name',
};

export function createRedactionContext(
  secrets: Record<string, string>
): RedactionContext {
  return {
    injectedSecrets: new Map(Object.entries(secrets)),
  };
}

export function redactString(
  value: string,
  ctx: RedactionContext,
  options: RedactionOptions = DEFAULT_OPTIONS
): string {
  let result = value;

  for (const [name, secret] of ctx.injectedSecrets) {
    if (secret && secret.length > 0) {
      const replacement = options.redactionFormat === 'name'
        ? `[${name}:REDACTED]`
        : '[REDACTED]';

      // Use global replace to catch all occurrences
      result = result.split(secret).join(replacement);
    }
  }

  return result;
}

export function redactResponse(
  response: HttpRequestResult,
  ctx: RedactionContext,
  options: RedactionOptions = DEFAULT_OPTIONS
): HttpRequestResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const result = { ...response };

  // Redact headers
  if (opts.redactHeaders && response.headers) {
    result.headers = { ...response.headers };
    for (const [headerKey, headerValue] of Object.entries(result.headers)) {
      result.headers[headerKey] = redactString(headerValue, ctx, opts);
    }
  }

  // Redact body
  if (opts.redactBody && response.body) {
    result.body = redactString(response.body, ctx, opts);
  }

  return result;
}

// Convenience function for Buffer/string results from execSync
export function redactSecrets(
  output: Buffer | string,
  secrets: Record<string, string>
): Buffer | string {
  const ctx = createRedactionContext(secrets);
  const isBuffer = Buffer.isBuffer(output);
  const str = isBuffer ? output.toString() : output;
  const redacted = redactString(str, ctx);
  return isBuffer ? Buffer.from(redacted) : redacted;
}
```

### Security Considerations

1. **Timing attacks**: Redaction should use constant-time comparison where possible
2. **Partial matches**: Be careful with secrets that are substrings of legitimate data
3. **Encoding**: Handle URL-encoded, base64-encoded, and other encoded forms of secrets
4. **Logging**: Never log the unredacted response

---

## 5. AgentLink Integration into AgenShield

### Current State

- AgentLink is a separate skill in `tools/agentlink-skill/`
- Has its own CLI, token storage logic
- Tokens stored in daemon vault via `/api/agentlink` routes
- Skill copied to OpenClaw's skills folder during setup

### Required Change

- AgentLink becomes a core part of AgenShield (not a separate skill)
- The `agentlink` binary becomes a thin proxy to AgenShield daemon
- All auth logic centralized in daemon
- Skill in OpenClaw just describes the capability, execution goes through daemon

### New Architecture

```mermaid
sequenceDiagram
    participant Agent as Agent (clawagent)
    participant Bin as agentlink binary
    participant Daemon as AgenShield Daemon
    participant Vault as Token Vault
    participant External as External API (Slack, etc.)

    Note over Agent,External: Authentication Flow
    Agent->>Bin: agentlink auth slack
    Bin->>Daemon: POST /api/agentlink/cli {command: "auth", args: ["slack"]}
    Daemon->>Daemon: Generate OAuth URL
    Daemon-->>Bin: {output: "Visit: https://...", exitCode: 0}
    Bin-->>Agent: Visit: https://...

    Note over Agent,External: Tool Execution Flow
    Agent->>Bin: agentlink tool run slack send_message --channel #general --text "Hello"
    Bin->>Daemon: POST /api/agentlink/cli {command: "tool", args: ["run", "slack", ...]}
    Daemon->>Vault: Get slack token
    Vault-->>Daemon: token
    Daemon->>External: POST /api/chat.postMessage (with token)
    External-->>Daemon: {ok: true, ...}
    Daemon-->>Bin: {output: "Message sent", exitCode: 0}
    Bin-->>Agent: Message sent
```

### Files to Modify

#### `tools/agentlink-skill/bin/agentlink.js` (Convert to Proxy)

```javascript
#!/usr/bin/env node

const http = require('http');

const DAEMON_PORT = process.env.AGENSHIELD_DAEMON_PORT || 3847;
const DAEMON_HOST = process.env.AGENSHIELD_DAEMON_HOST || 'localhost';

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage: agentlink <command> [args...]');
    console.log('Commands: auth, tool, status, logout');
    process.exit(0);
  }

  const [command, ...commandArgs] = args;

  try {
    const response = await fetch(`http://${DAEMON_HOST}:${DAEMON_PORT}/api/agentlink/cli`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command,
        args: commandArgs,
        cwd: process.cwd(),
        env: {
          // Pass through relevant env vars
          AGENTLINK_SESSION: process.env.AGENTLINK_SESSION,
        }
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`Error: ${error}`);
      process.exit(1);
    }

    const result = await response.json();

    if (result.output) {
      process.stdout.write(result.output);
    }
    if (result.error) {
      process.stderr.write(result.error);
    }

    process.exit(result.exitCode || 0);

  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      console.error('Error: AgenShield daemon is not running');
      console.error('Start the daemon with: agenshield daemon start');
    } else {
      console.error(`Error: ${error.message}`);
    }
    process.exit(1);
  }
}

main();
```

#### `libs/shield-daemon/src/routes/agentlink.ts` (Add CLI Endpoint)

```typescript
import { Router } from 'express';
import { AgentLinkService } from '../services/agentlink';

export function createAgentLinkRoutes(service: AgentLinkService): Router {
  const router = Router();

  // Existing routes...

  // New CLI proxy endpoint
  router.post('/cli', async (req, res) => {
    const { command, args, cwd, env } = req.body;

    try {
      const result = await service.handleCli(command, args, { cwd, env });
      res.json(result);
    } catch (error) {
      res.status(500).json({
        output: '',
        error: error.message,
        exitCode: 1
      });
    }
  });

  return router;
}
```

#### `libs/shield-daemon/src/services/agentlink.ts` (New Service)

```typescript
export interface CliResult {
  output: string;
  error?: string;
  exitCode: number;
}

export interface CliContext {
  cwd?: string;
  env?: Record<string, string>;
}

export class AgentLinkService {
  constructor(
    private vault: VaultService,
    private config: AgentLinkConfig
  ) {}

  async handleCli(
    command: string,
    args: string[],
    ctx: CliContext
  ): Promise<CliResult> {
    switch (command) {
      case 'auth':
        return this.handleAuth(args);
      case 'tool':
        return this.handleTool(args);
      case 'status':
        return this.handleStatus();
      case 'logout':
        return this.handleLogout(args);
      default:
        return {
          output: '',
          error: `Unknown command: ${command}`,
          exitCode: 1
        };
    }
  }

  private async handleAuth(args: string[]): Promise<CliResult> {
    const [provider] = args;
    if (!provider) {
      return {
        output: 'Usage: agentlink auth <provider>\nProviders: slack, github, notion, linear',
        error: '',
        exitCode: 0
      };
    }

    const authUrl = await this.generateAuthUrl(provider);
    return {
      output: `To authenticate with ${provider}, visit:\n${authUrl}\n`,
      exitCode: 0
    };
  }

  private async handleTool(args: string[]): Promise<CliResult> {
    // Parse: tool run <provider> <action> [--args]
    const [subcommand, provider, action, ...toolArgs] = args;

    if (subcommand !== 'run') {
      return {
        output: 'Usage: agentlink tool run <provider> <action> [args...]',
        error: '',
        exitCode: 0
      };
    }

    const token = await this.vault.getToken(provider);
    if (!token) {
      return {
        output: '',
        error: `Not authenticated with ${provider}. Run: agentlink auth ${provider}`,
        exitCode: 1
      };
    }

    try {
      const result = await this.executeTool(provider, action, toolArgs, token);
      return {
        output: JSON.stringify(result, null, 2) + '\n',
        exitCode: 0
      };
    } catch (error) {
      return {
        output: '',
        error: `Tool execution failed: ${error.message}`,
        exitCode: 1
      };
    }
  }

  // ... additional methods
}
```

---

## 6. Skills Folder Watching & Approval Workflow

### Current State

- Skills injected once during setup via `libs/shield-sandbox/src/skill-injector.ts`
- No runtime monitoring of skills folder
- Security watcher only monitors daemon health, not skills

### Required Change

Daemon continuously watches agent's skills folder:
1. New/unrecognized skills are immediately removed
2. Moved to root-owned quarantine directory
3. Notification sent via SSE to dashboard
4. Approved skills copied back to agent's folder

### Architecture

```mermaid
flowchart TB
    subgraph "Agent Space (clawagent user)"
        AS[Agent Skills Dir<br>/var/lib/agenshield/agent/.openclaw/skills/]
    end

    subgraph "Root Space (root user)"
        QD[Quarantine Dir<br>/root/.agenshield/quarantine/skills/<br>mode: 0700]
        AP[Approved Skills List<br>/root/.agenshield/config/approved-skills.json]
    end

    subgraph "Daemon (root)"
        SW[Skills Watcher]
        SR[Skills Routes API]
        SSE[SSE Events]
    end

    subgraph "Dashboard"
        UI[Admin UI]
    end

    AS -->|fs.watch| SW
    SW -->|"New skill detected"| QD
    SW -->|"Emit event"| SSE
    SSE -->|"skill:quarantined"| UI
    UI -->|"POST /api/skills/:name/approve"| SR
    SR -->|"Read approved"| AP
    SR -->|"Copy to agent"| AS
    SR -->|"Update list"| AP
```

### Security Model

| Directory | Owner | Mode | Agent Access |
|-----------|-------|------|--------------|
| Agent skills | clawagent:clawagent | 0755 | Read/Write |
| Quarantine | root:root | 0700 | **NONE** |
| Approved list | root:root | 0600 | **NONE** |

Agent user (clawagent) has **NO** access to quarantine folder. Skills can only be approved by root/admin through daemon API.

### Files to Create

#### `libs/shield-daemon/src/watchers/skills.ts`

```typescript
import * as fs from 'fs/promises';
import * as path from 'path';
import { watch, FSWatcher } from 'fs';
import { EventEmitter } from 'events';

export interface SkillInfo {
  name: string;
  path: string;
  detectedAt: Date;
  hash?: string;
}

export interface SkillsWatcherConfig {
  agentSkillsDir: string;     // /var/lib/agenshield/agent/.openclaw/skills/
  quarantineDir: string;      // /root/.agenshield/quarantine/skills/
  approvedSkillsFile: string; // /root/.agenshield/config/approved-skills.json
  pollInterval?: number;      // Fallback polling interval (ms)
}

export class SkillsWatcher extends EventEmitter {
  private watcher: FSWatcher | null = null;
  private approvedSkills: Set<string> = new Set();
  private pollTimer: NodeJS.Timer | null = null;

  constructor(private config: SkillsWatcherConfig) {
    super();
  }

  async start(): Promise<void> {
    // Load approved skills
    await this.loadApprovedSkills();

    // Ensure quarantine exists with restricted permissions
    await fs.mkdir(this.config.quarantineDir, { recursive: true, mode: 0o700 });

    // Initial scan
    await this.scanSkillsDirectory();

    // Start watching
    try {
      this.watcher = watch(
        this.config.agentSkillsDir,
        { persistent: true },
        (event, filename) => {
          if (filename) {
            this.handleSkillChange(filename, event);
          }
        }
      );

      this.watcher.on('error', (error) => {
        console.error('[SkillsWatcher] Watch error:', error);
        this.startPolling();
      });

    } catch (error) {
      console.warn('[SkillsWatcher] fs.watch failed, falling back to polling');
      this.startPolling();
    }
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async loadApprovedSkills(): Promise<void> {
    try {
      const data = await fs.readFile(this.config.approvedSkillsFile, 'utf-8');
      const list = JSON.parse(data);
      this.approvedSkills = new Set(list.approved || []);
    } catch (error) {
      // File doesn't exist yet, start with empty set
      this.approvedSkills = new Set();
    }
  }

  private async saveApprovedSkills(): Promise<void> {
    const data = JSON.stringify({
      approved: Array.from(this.approvedSkills),
      updatedAt: new Date().toISOString()
    }, null, 2);

    await fs.writeFile(this.config.approvedSkillsFile, data, { mode: 0o600 });
  }

  private async scanSkillsDirectory(): Promise<void> {
    try {
      const entries = await fs.readdir(this.config.agentSkillsDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory() && !this.approvedSkills.has(entry.name)) {
          await this.quarantineSkill(entry.name);
        }
      }
    } catch (error) {
      console.error('[SkillsWatcher] Scan error:', error);
    }
  }

  private async handleSkillChange(filename: string, event: string): Promise<void> {
    // Debounce rapid changes
    const skillPath = path.join(this.config.agentSkillsDir, filename);

    try {
      const stat = await fs.stat(skillPath);

      if (stat.isDirectory() && !this.approvedSkills.has(filename)) {
        await this.quarantineSkill(filename);
      }
    } catch (error) {
      // File might have been deleted, ignore
    }
  }

  private async quarantineSkill(skillName: string): Promise<void> {
    const sourcePath = path.join(this.config.agentSkillsDir, skillName);
    const quarantinePath = path.join(this.config.quarantineDir, skillName);

    try {
      // Check if already quarantined
      try {
        await fs.access(quarantinePath);
        // Already exists in quarantine, just remove from agent dir
        await fs.rm(sourcePath, { recursive: true, force: true });
        return;
      } catch {
        // Not in quarantine yet, proceed
      }

      // Move to quarantine
      await fs.rename(sourcePath, quarantinePath);

      // Ensure quarantine permissions
      await fs.chmod(quarantinePath, 0o700);

      const skillInfo: SkillInfo = {
        name: skillName,
        path: quarantinePath,
        detectedAt: new Date()
      };

      // Emit event for SSE
      this.emit('skill:quarantined', skillInfo);

      console.log(`[SkillsWatcher] Quarantined skill: ${skillName}`);

    } catch (error) {
      console.error(`[SkillsWatcher] Failed to quarantine ${skillName}:`, error);

      // If move failed, at least try to delete from agent dir
      try {
        await fs.rm(sourcePath, { recursive: true, force: true });
      } catch {
        // Ignore
      }
    }
  }

  async approveSkill(skillName: string): Promise<boolean> {
    const quarantinePath = path.join(this.config.quarantineDir, skillName);
    const targetPath = path.join(this.config.agentSkillsDir, skillName);

    try {
      // Copy from quarantine to agent skills dir
      await this.copyDir(quarantinePath, targetPath);

      // Fix ownership (run as root, set to clawagent)
      // Note: This requires the daemon to run as root
      const { exec } = require('child_process');
      await new Promise<void>((resolve, reject) => {
        exec(`chown -R clawagent:clawagent "${targetPath}"`, (error: Error | null) => {
          if (error) reject(error);
          else resolve();
        });
      });

      // Add to approved list
      this.approvedSkills.add(skillName);
      await this.saveApprovedSkills();

      // Remove from quarantine
      await fs.rm(quarantinePath, { recursive: true, force: true });

      this.emit('skill:approved', { name: skillName, approvedAt: new Date() });

      return true;

    } catch (error) {
      console.error(`[SkillsWatcher] Failed to approve ${skillName}:`, error);
      return false;
    }
  }

  async rejectSkill(skillName: string): Promise<boolean> {
    const quarantinePath = path.join(this.config.quarantineDir, skillName);

    try {
      await fs.rm(quarantinePath, { recursive: true, force: true });
      this.emit('skill:rejected', { name: skillName, rejectedAt: new Date() });
      return true;
    } catch (error) {
      console.error(`[SkillsWatcher] Failed to reject ${skillName}:`, error);
      return false;
    }
  }

  async listQuarantined(): Promise<SkillInfo[]> {
    try {
      const entries = await fs.readdir(this.config.quarantineDir, { withFileTypes: true });
      const skills: SkillInfo[] = [];

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillPath = path.join(this.config.quarantineDir, entry.name);
          const stat = await fs.stat(skillPath);
          skills.push({
            name: entry.name,
            path: skillPath,
            detectedAt: stat.mtime
          });
        }
      }

      return skills;
    } catch (error) {
      return [];
    }
  }

  async listApproved(): Promise<string[]> {
    return Array.from(this.approvedSkills);
  }

  private async copyDir(src: string, dest: string): Promise<void> {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        await this.copyDir(srcPath, destPath);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }

  private startPolling(): void {
    const interval = this.config.pollInterval || 5000;
    this.pollTimer = setInterval(() => this.scanSkillsDirectory(), interval);
  }
}
```

#### `libs/shield-daemon/src/routes/skills.ts`

```typescript
import { Router, Request, Response } from 'express';
import { SkillsWatcher, SkillInfo } from '../watchers/skills';

export function createSkillsRoutes(watcher: SkillsWatcher): Router {
  const router = Router();

  // List all skills (approved + quarantined)
  router.get('/', async (req: Request, res: Response) => {
    const [approved, quarantined] = await Promise.all([
      watcher.listApproved(),
      watcher.listQuarantined()
    ]);

    res.json({
      approved: approved.map(name => ({ name, status: 'approved' })),
      quarantined: quarantined.map(skill => ({
        name: skill.name,
        status: 'quarantined',
        detectedAt: skill.detectedAt
      }))
    });
  });

  // List quarantined skills
  router.get('/quarantine', async (req: Request, res: Response) => {
    const skills = await watcher.listQuarantined();
    res.json({ skills });
  });

  // Get quarantined skill details
  router.get('/quarantine/:name', async (req: Request, res: Response) => {
    const { name } = req.params;
    const skills = await watcher.listQuarantined();
    const skill = skills.find(s => s.name === name);

    if (!skill) {
      return res.status(404).json({ error: 'Skill not found in quarantine' });
    }

    // TODO: Read skill manifest for details
    res.json(skill);
  });

  // Approve a quarantined skill
  router.post('/:name/approve', async (req: Request, res: Response) => {
    const { name } = req.params;
    const success = await watcher.approveSkill(name);

    if (success) {
      res.json({ message: `Skill '${name}' approved and installed` });
    } else {
      res.status(400).json({ error: `Failed to approve skill '${name}'` });
    }
  });

  // Reject and delete a quarantined skill
  router.delete('/:name', async (req: Request, res: Response) => {
    const { name } = req.params;
    const success = await watcher.rejectSkill(name);

    if (success) {
      res.json({ message: `Skill '${name}' rejected and deleted` });
    } else {
      res.status(400).json({ error: `Failed to reject skill '${name}'` });
    }
  });

  // Revoke approval (remove from agent, keep in quarantine)
  router.post('/:name/revoke', async (req: Request, res: Response) => {
    // TODO: Implement revocation
    res.status(501).json({ error: 'Not implemented' });
  });

  return router;
}
```

### Config Updates

#### `libs/shield-daemon/src/config/defaults.ts`

```typescript
export const DEFAULT_CONFIG = {
  // ... existing config

  skills: {
    agentSkillsDir: '/var/lib/agenshield/agent/.openclaw/skills',
    quarantineDir: '/root/.agenshield/quarantine/skills',
    approvedSkillsFile: '/root/.agenshield/config/approved-skills.json',
    watchEnabled: true,
    pollInterval: 5000, // ms, fallback if fs.watch unavailable
  },
};
```

#### `libs/shield-sandbox/src/directories.ts`

```typescript
export const DIRECTORIES = {
  // ... existing directories

  quarantine: {
    root: '/root/.agenshield/quarantine',
    skills: '/root/.agenshield/quarantine/skills',
  },
};
```

---

## Migration Path

### Phase 1: Bin Proxies & Secret Vault

1. Implement `SecretVault` with ref token generation and encryption
2. Implement `bin-generator` to create Node.js bin proxies
3. Implement JSON-RPC Unix socket server in daemon
4. Implement `command.execute` handler with ref resolution and redaction
5. Add `/api/secrets` REST routes for secret management
6. Test end-to-end: register secret, run proxied curl, verify redaction

### Phase 2: Preload Foundation

1. Create `@agenshield/preload` package
2. Implement child_process patches (spawn/exec)
3. Integrate with bin proxy ref detection
4. No breaking changes to existing wrappers

### Phase 3: Response Formatters

1. Create formatter classes for curl, wget
2. Add formatter selection based on command
3. Update shield-client to use formatters
4. Maintain backward compatibility

### Phase 4: Secret Redaction

1. Implement RedactionContext
2. Add redaction to preload patches
3. Add redaction to command.execute handler
4. Test with various secret formats and encodings

### Phase 5: AgentLink Migration

1. Update agentlink binary to proxy mode (reuse bin proxy pattern)
2. Add /cli endpoint to daemon
3. Migrate token management to daemon
4. Update skill to describe-only mode

### Phase 6: Skills Watching

1. Implement SkillsWatcher
2. Add skills routes to daemon
3. Update dashboard for approval workflow
4. Test quarantine flow

---

## API Changes

### New REST Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/secrets` | Register a new secret (returns ref token) |
| GET | `/api/secrets` | List secrets (names + refs, never values) |
| DELETE | `/api/secrets/:ref` | Revoke a secret |
| POST | `/api/secrets/:ref/rotate` | Rotate secret value (same ref, new value) |
| POST | `/api/agentlink/cli` | AgentLink CLI proxy |
| GET | `/api/skills` | List all skills |
| GET | `/api/skills/quarantine` | List quarantined skills |
| POST | `/api/skills/:name/approve` | Approve skill |
| DELETE | `/api/skills/:name` | Reject skill |

### JSON-RPC Methods (Unix Socket)

| Method | Params | Description |
|--------|--------|-------------|
| `command.execute` | `{command, args, refs, cwd, flags}` | Execute command with secret ref resolution |
| `refs.resolve` | `{refs: string[]}` | Resolve refs to names (not values) for logging |
| `refs.validate` | `{refs: string[]}` | Check if refs are still valid |

### SSE Events

| Event | Payload | Description |
|-------|---------|-------------|
| `skill:quarantined` | `{name, detectedAt}` | New skill quarantined |
| `skill:approved` | `{name, approvedAt}` | Skill approved |
| `skill:rejected` | `{name, rejectedAt}` | Skill rejected |

---

## Security Considerations

### 1. Secret Reference Token Security

- Agent only sees ref tokens (`__AGENSHIELD_REF_*`), never real secret values
- Ref tokens are 16 hex chars of randomness (64 bits of entropy) - not guessable
- The `__AGENSHIELD_REF_` prefix is intentionally distinctive so refs are easy to detect and redact
- Daemon resolves refs in-memory only; real values never touch agent disk or env
- Agent cannot read `/proc/self/environ` to extract secrets (only ref tokens there)
- Ref tokens are revocable; revoking a ref makes it unresolvable immediately
- Audit: every ref resolution is logged with timestamp, command, and caller

### 2. Bin Proxy Security

- Proxy binaries are owned by root, read+execute only for agent user
- Proxy dir is prepended to PATH so it always takes precedence
- `.real-paths.json` is generated at startup by scanning system PATH without proxy dir
- JSON-RPC communication uses Unix socket with file permissions (root only write)
- Fast path (no refs) calls real binary directly - no daemon overhead

### 3. Preload Security

- Preload runs in agent's process space
- Must not expose internal secrets to agent
- Broker communication should be authenticated

### 4. Secret Handling

- Secrets fetched from daemon just-in-time via ref resolution
- Never written to disk in agent space
- Redacted from all outputs (stdout, stderr, headers, body)
- Multiple encodings of secrets are tracked (URL-encoded, base64, etc.)

### 5. Skills Quarantine

- Quarantine directory is root-owned (mode 0700)
- Agent user cannot access quarantine
- Only root/admin can approve skills
- Skills are validated before installation

### 6. AgentLink Tokens

- Tokens stored in daemon vault (encrypted)
- Agent only receives short-lived session tokens
- OAuth refresh handled by daemon

### 7. Process Isolation

- Daemon runs as root
- Agent runs as clawagent (unprivileged)
- IPC through well-defined API boundaries
