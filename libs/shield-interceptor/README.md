# @agenshield/interceptor

Node.js runtime interception via ESM loader and CJS preload for AgenShield.

## Overview

This library intercepts Node.js runtime APIs to route all network and file operations through the AgenShield broker daemon, ensuring policy enforcement even for code that doesn't use the broker client directly.

## Installation

```bash
npm install @agenshield/interceptor
```

## Usage

### ESM Loader (Recommended)

```bash
# Node.js 20+
node --import @agenshield/interceptor/register app.js

# Or with tsx
tsx --import @agenshield/interceptor/register app.ts
```

### CommonJS Preload

```bash
node -r @agenshield/interceptor/require app.js
```

### Programmatic

```typescript
import { installInterceptors, uninstallInterceptors } from '@agenshield/interceptor';

// Install all interceptors
installInterceptors({
  socketPath: '/var/run/agenshield.sock',
  failOpen: false,
});

// Your application code...

// Cleanup (optional)
uninstallInterceptors();
```

## Intercepted APIs

### Network APIs

| API | Intercepted Methods |
|-----|---------------------|
| `fetch` | Global `fetch()` |
| `http` | `request()`, `get()` |
| `https` | `request()`, `get()` |
| `WebSocket` | `constructor` |
| `undici` | `fetch()`, `request()` |

### File System APIs

| API | Intercepted Methods |
|-----|---------------------|
| `fs` | `readFile`, `writeFile`, `readdir`, `unlink`, `mkdir`, `rmdir` |
| `fs/promises` | All promise-based equivalents |
| `fs` (sync) | `readFileSync`, `writeFileSync`, etc. |

### Process APIs

| API | Intercepted Methods |
|-----|---------------------|
| `child_process` | `exec`, `execSync`, `spawn`, `spawnSync`, `execFile`, `fork` |

## Configuration

Configure via environment variables:

```bash
# Broker connection
AGENSHIELD_SOCKET=/var/run/agenshield.sock
AGENSHIELD_HTTP_HOST=localhost
AGENSHIELD_HTTP_PORT=6969

# Behavior
AGENSHIELD_FAIL_OPEN=false           # Allow operations if broker unavailable
AGENSHIELD_LOG_LEVEL=warn            # debug, info, warn, error

# Enable/disable specific interceptors
AGENSHIELD_INTERCEPT_FETCH=true
AGENSHIELD_INTERCEPT_HTTP=true
AGENSHIELD_INTERCEPT_WS=true
AGENSHIELD_INTERCEPT_FS=true
AGENSHIELD_INTERCEPT_EXEC=true
```

## How It Works

```
┌──────────────────────────────────────────────────────────┐
│                    Application Code                       │
│                                                          │
│  fetch('https://api.example.com')                        │
│  fs.readFile('/etc/passwd')                              │
│  exec('curl https://evil.com')                           │
└──────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────┐
│                   Interceptor Layer                       │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐            │
│  │   fetch    │ │    fs      │ │   exec     │            │
│  │interceptor │ │interceptor │ │interceptor │            │
│  └─────┬──────┘ └─────┬──────┘ └─────┬──────┘            │
│        └──────────────┼──────────────┘                   │
│                       ▼                                   │
│              ┌─────────────────┐                          │
│              │  Broker Client  │                          │
│              │  (Unix Socket)  │                          │
│              └────────┬────────┘                          │
└──────────────────────────────────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────────────┐
│                   Broker Daemon                           │
│  • Policy Check                                          │
│  • Audit Log                                             │
│  • Execute Operation (if allowed)                        │
└──────────────────────────────────────────────────────────┘
```

## Policy Enforcement

When an intercepted call is made:

1. **Intercept** - The original API call is intercepted
2. **Serialize** - Request parameters are serialized to JSON-RPC
3. **Send** - Request is sent to broker via Unix socket
4. **Policy Check** - Broker checks against configured policies
5. **Execute/Deny** - Broker either executes the operation or returns error
6. **Return** - Result is returned to the application

### Denied Operations

When a policy denies an operation:

```typescript
try {
  await fetch('https://blocked-site.com');
} catch (error) {
  // AgenShieldPolicyError: Operation denied by policy
  // error.code = 'POLICY_DENIED'
  // error.operation = 'http_request'
  // error.target = 'https://blocked-site.com'
}
```

## Fail-Open vs Fail-Closed

**Fail-Closed (default)**: If the broker is unavailable, all operations are denied.

```bash
AGENSHIELD_FAIL_OPEN=false
```

**Fail-Open**: If the broker is unavailable, operations proceed without policy checks.

```bash
AGENSHIELD_FAIL_OPEN=true
```

## Sync Operations

For synchronous operations (`execSync`, `readFileSync`, etc.), the interceptor uses a synchronous IPC client that blocks until the broker responds.

## Limitations

- Cannot intercept native modules that bypass Node.js APIs
- WebSocket interception requires the `ws` package
- Some edge cases with streaming responses may have slight behavior differences

## Debugging

Enable debug logging:

```bash
AGENSHIELD_LOG_LEVEL=debug node --import @agenshield/interceptor/register app.js
```

## License

MIT
