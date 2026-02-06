# @agenshield/broker

Core broker daemon for AgenShield. It enforces security policies and performs privileged operations on behalf of sandboxed agents.

## Purpose
- Enforce policy decisions for network, file, and exec operations.
- Provide a Unix socket JSON-RPC API for local, privileged actions.
- Offer a restricted HTTP fallback for environments that cannot use Unix sockets.
- Emit auditable logs for every operation.

## Key Components
- `src/main.ts` - Broker daemon entry point.
- `src/server.ts` - Unix socket JSON-RPC server (newline-delimited JSON).
- `src/http-fallback.ts` - Restricted HTTP JSON-RPC server (`/rpc`).
- `src/handlers/*` - Operation handlers (`http_request`, `file_*`, `exec`, etc.).
- `src/policies/*` - Policy enforcement and built-in rules.
- `src/audit/logger.ts` - JSONL audit log with rotation.
- `src/secrets/vault.ts` - Encrypted secret storage for `secret_inject`.
- `src/client/broker-client.ts` - Type-safe client for code integrations.
- `src/client/shield-client.ts` - CLI client (`shield-client`).

## Operations (JSON-RPC methods)
- `http_request` - Proxy HTTP requests.
- `file_read`, `file_write`, `file_list` - File system operations.
- `exec` - Execute a command.
- `open_url` - Open a URL in the default browser (macOS `open`).
- `secret_inject` - Read a secret from the vault (socket-only).
- `ping` - Health check.

## Usage
### Run the broker
```bash
agenshield-broker

# Custom socket path
AGENSHIELD_SOCKET=/tmp/agenshield.sock agenshield-broker

# Disable HTTP fallback
AGENSHIELD_HTTP_ENABLED=false agenshield-broker
```

### Use the client library
```ts
import { BrokerClient } from '@agenshield/broker/client';

const client = new BrokerClient({
  socketPath: '/var/run/agenshield.sock',
});

const response = await client.httpRequest({
  url: 'https://api.example.com/data',
  method: 'GET',
});

const file = await client.fileRead({ path: '/path/to/file.txt' });
const execResult = await client.exec({ command: 'ls', args: ['-la'] });
```

### Use the CLI client
```bash
shield-client ping
shield-client http GET https://api.example.com/data
shield-client file read /path/to/file.txt
shield-client exec ls -la
```

## Configuration
The broker loads configuration from a file (default: `/opt/agenshield/config/shield.json`) and overlays environment variables.

Environment variables:
- `AGENSHIELD_CONFIG` - Config file path.
- `AGENSHIELD_SOCKET` - Unix socket path (default: `/var/run/agenshield.sock`).
- `AGENSHIELD_HTTP_ENABLED` - `true`/`false` to enable HTTP fallback.
- `AGENSHIELD_HTTP_HOST` - HTTP fallback host (default: `localhost`).
- `AGENSHIELD_HTTP_PORT` - HTTP fallback port (default: `5200`).
- `AGENSHIELD_POLICIES` - Policies directory (default: `/opt/agenshield/policies`).
- `AGENSHIELD_AUDIT_LOG` - Audit log path (default: `/var/log/agenshield/audit.log`).
- `AGENSHIELD_LOG_LEVEL` - `debug|info|warn|error`.
- `AGENSHIELD_FAIL_OPEN` - `true` to allow on policy-check failure.

Config file fields (subset):
```json
{
  "socketPath": "/var/run/agenshield.sock",
  "httpEnabled": true,
  "httpHost": "localhost",
  "httpPort": 5200,
  "policiesPath": "/opt/agenshield/policies",
  "auditLogPath": "/var/log/agenshield/audit.log",
  "logLevel": "info",
  "failOpen": false,
  "socketMode": 504
}
```

## Policy Model
- Policies are loaded from `policiesPath/default.json` plus any JSON files in `policiesPath/custom/`.
- Rules are allowlist/denylist with glob-style matching and priority ordering.
- File and network constraints can enforce allowed paths/hosts/ports.
- Policies are reloaded on a timer (every 60 seconds).

## HTTP Fallback Constraints
The HTTP fallback server is intentionally restricted:
- Allowed: `http_request`, `file_read`, `file_list`, `open_url`, `ping`.
- Denied: `exec`, `file_write`, `secret_inject`.
- Only accepts `POST /rpc` from localhost.
- `GET /health` returns a simple health response.

## Limitations and Caveats
- No authentication layer; security relies on Unix socket permissions and policy rules.
- HTTP fallback is localhost-only and still policy-enforced but should be treated as a last resort.
- `open_url` is macOS-specific (uses `open`).
- `exec` output is capped at 10MB and does not stream.
- The secret vault stores a `.key` file alongside the encrypted vault; it does not integrate with OS keychains.
- Policy reload is timer-based; updates are not immediate.

## Roadmap (Ideas)
- Per-client identity from socket credentials and scoped policies.
- Optional auth and mTLS for the HTTP fallback.
- Streaming responses for large outputs.
- Cross-platform URL opening.

## Development
```bash
# Build
npx nx build shield-broker
```

## Contribution Guide
- When adding a new operation, update:
  - `src/handlers/*` (handler implementation)
  - `src/server.ts` and `src/http-fallback.ts` (method routing + HTTP allowlist)
  - `@agenshield/ipc` operation types and schemas
- Keep all handler errors mapped to a stable error code.
- Audit entries should include a deterministic `target` field for policy visibility.

## Agent Notes
- `BrokerClient` enforces socket-only channels for `exec`, `file_write`, and `secret_inject`.
- The policy enforcer merges built-in rules with user rules; custom policies are additive.
- `AuditLogger` is append-only JSONL with rotation; use it for operational forensics.
- Any changes to JSON-RPC method names must be mirrored in `@agenshield/ipc`.
