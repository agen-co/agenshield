# @agenshield/interceptor

Node.js runtime interception via ESM loader and CJS preload. It instruments selected Node APIs to apply AgenShield policy checks and (in some cases) route traffic through the broker.

## Purpose
- Enforce policy checks inside a Node process without changing application code.
- Provide a quick on-ramp for CLI tools (npm, curl wrappers, etc.).
- Emit local audit events to the broker.

## Installation
```bash
npm install @agenshield/interceptor
```

## Usage
### ESM loader (recommended)
```bash
node --import @agenshield/interceptor/register app.js
```

### CommonJS preload
```bash
node -r @agenshield/interceptor/require app.js
```

### Programmatic
```ts
import { installInterceptors, uninstallInterceptors } from '@agenshield/interceptor';

installInterceptors({
  socketPath: '/var/run/agenshield.sock',
  failOpen: false,
});

// ... your app ...

uninstallInterceptors();
```

## What Gets Intercepted
- `fetch` (global)
- `http` / `https` (`request`, `get`)
- `WebSocket` (global, if present)
- `fs`, `fs/promises` (read/write/list)
- `child_process` (`exec`, `spawn`, `execSync`, etc.)

## Configuration
`createConfig()` reads environment variables (or you can pass overrides to `installInterceptors()`):

- `AGENSHIELD_SOCKET` - Unix socket path.
- `AGENSHIELD_HOST` - HTTP fallback host.
- `AGENSHIELD_PORT` - HTTP fallback port.
- `AGENSHIELD_FAIL_OPEN` - `true` to allow operations if broker is unreachable.
- `AGENSHIELD_LOG_LEVEL` - `debug|info|warn|error`.
- `AGENSHIELD_INTERCEPT_FETCH` - enable/disable fetch interception.
- `AGENSHIELD_INTERCEPT_HTTP` - enable/disable http/https interception.
- `AGENSHIELD_INTERCEPT_WS` - enable/disable WebSocket interception.
- `AGENSHIELD_INTERCEPT_FS` - enable/disable fs interception.
- `AGENSHIELD_INTERCEPT_EXEC` - enable/disable child_process interception.
- `AGENSHIELD_TIMEOUT` - broker request timeout (ms).
- `AGENSHIELD_POLICY_CACHE_TTL` - policy cache TTL (ms).

## Behavior Details (Important)
- `fetch` requests are proxied through the broker (`http_request`) and return a synthetic `Response`.
- `http`/`https` requests are NOT proxied; a policy check runs asynchronously and may destroy the request if denied.
- `fs` async APIs perform a policy check, then call the original local method (no broker proxy).
- `fs` sync APIs perform a synchronous policy check via `SyncClient`, then call the original local method.
- `child_process.exec` performs an async policy check and returns a dummy process immediately; the actual command is executed only after policy approval.
- `child_process.spawn` and `execFile` perform async policy checks but still start the process immediately.
- `WebSocket` interception closes connections post-hoc if denied.

## Limitations and Caveats
- Only `fetch` is truly proxied through the broker; other interceptors are policy checks around local calls.
- Async HTTP and process interceptors cannot fully block before the underlying operation starts.
- Sync interceptors (`fs`, `execSync`, `spawnSync`) use a hardcoded broker socket/host/port (`/var/run/agenshield.sock`, `localhost:6969`) and ignore config overrides.
- Broker URL bypass checks are hardcoded to `localhost:6969`; non-default ports can lead to interception recursion.
- WebSocket interception requires `globalThis.WebSocket` to exist (not always true in Node without a polyfill).
- Native modules or direct syscalls that bypass Node APIs are not intercepted.

## Roadmap (Ideas)
- Use config overrides for sync clients.
- Full proxying for http/https and child_process where possible.
- Safer broker URL detection for non-default ports.
- Comprehensive test suite around interception edge cases.

## Development
```bash
# Build
npx nx build shield-interceptor
```

## Contribution Guide
- Keep interceptors isolated and reversible (always restore originals).
- Add new interceptors in `src/interceptors/` and register in `src/installer.ts`.
- Extend `@agenshield/ipc` if new operation types are introduced.

## Agent Notes
- `src/installer.ts` is the authoritative install/uninstall sequence.
- `src/interceptors/base.ts` handles policy checks and fail-open behavior.
- `src/client/http-client.ts` is async (socket then HTTP), while `src/client/sync-client.ts` uses a subprocess for sync calls.
- When adjusting policy checks, update `PolicyEvaluator` caching semantics in `src/policy/`.
