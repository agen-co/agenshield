# @agenshield/daemon

AgenShield daemon is a Fastify-based HTTP service that exposes the management API and (optionally) serves the embedded UI. It is separate from the broker: this daemon focuses on control-plane operations, status, and UI interactions.

## Purpose
- Provide a local HTTP API for status, config, and security checks.
- Serve the management UI if assets are present.
- Stream live events over Server-Sent Events (SSE).
- Handle passcode authentication and session management.
- Offer AgentLink integration for MCP tool access.

## Key Components
- `src/main.ts` - Entry point, PID file handling, and server startup.
- `src/server.ts` - Fastify server setup + static UI serving.
- `src/routes/*` - HTTP endpoints and SSE routes.
- `src/auth/*` - Passcode hashing, session manager, auth middleware.
- `src/config/*` - Config loader and defaults.
- `src/state/*` - Persistent state file management.
- `src/vault/*` - Encrypted vault for tokens/secrets.
- `src/watchers/*` - Background watchers (security status).
- `src/events/*` - Event emitter feeding SSE.

## API Overview
Base prefix is `/api` (see `@agenshield/ipc` constants).

Core endpoints:
- `GET /api/health` - Health check.
- `GET /api/status` - Daemon status + version.
- `GET /api/config` - Current config.
- `PUT /api/config` - Update config.
- `GET /api/security` - Security status snapshot.

Wrappers:
- `GET /api/wrappers` - List available wrappers.
- `GET /api/wrappers/:name` - Wrapper details + generated content.
- `GET /api/wrappers/status` - Installed status.
- `POST /api/wrappers/install` - Install wrappers.
- `DELETE /api/wrappers/:name` - Uninstall wrapper.
- `PUT /api/wrappers/:name` - Update wrapper.
- `POST /api/wrappers/custom` - Add a custom wrapper.
- `DELETE /api/wrappers/custom/:name` - Remove a custom wrapper.
- `POST /api/wrappers/sync` - Sync wrapper set based on policy.
- `POST /api/wrappers/regenerate` - Regenerate installed wrappers.

Auth:
- `GET /api/auth/status`
- `POST /api/auth/setup`
- `POST /api/auth/unlock`
- `POST /api/auth/lock`
- `POST /api/auth/change`
- `POST /api/auth/refresh`
- `POST /api/auth/enable`
- `POST /api/auth/disable`

AgentLink:
- `POST /api/agentlink/auth/start`
- `POST /api/agentlink/auth/callback`
- `GET /api/agentlink/auth/status`
- `POST /api/agentlink/auth/logout`
- `POST /api/agentlink/tool/run`
- `GET /api/agentlink/tool/list`
- `GET /api/agentlink/tool/search`
- `GET /api/agentlink/integrations`
- `GET /api/agentlink/integrations/connected`
- `POST /api/agentlink/integrations/connect`

SSE:
- `GET /sse/events?token=...`
- `GET /sse/events/:filter?token=...`

## Authentication Model
- Passcodes are hashed with PBKDF2 and stored in the encrypted vault.
- Sessions are in-memory only (lost on daemon restart).
- Tokens can be supplied via `Authorization: Bearer <token>` or `?token=...` for SSE.
- Root users bypass authentication.
- Only selected routes are protected when passcode protection is enabled.

## Configuration and State
- Config file: `~/.agenshield/config.json`
- State file: `~/.agenshield/state.json`
- Vault file: `~/.agenshield/vault.enc` (encrypted with machine-bound key)

Defaults are defined in `@agenshield/ipc` and `src/config/defaults.ts`.

## Limitations and Caveats
- No HTTPS/TLS built in; intended for localhost use.
- CORS is fully enabled for development.
- Sessions are not persisted; tokens become invalid after restart.
- Wrapper operations depend on `@agenshield/sandbox` (macOS-specific).
- SSE is best-effort; no replay or persistence of events.
- Default wrapper target dir is hardcoded to `/Users/clawagent/bin`.

## Roadmap (Ideas)
- Persisted sessions and stronger auth/scopes.
- OpenAPI schema for clients.
- Cross-platform wrapper management.
- Metrics and health probes beyond `/health`.

## Development
```bash
# Run directly
npx tsx libs/shield-daemon/src/main.ts

# Build
npx nx build shield-daemon
```

## Contribution Guide
- Add new routes in `src/routes/` and register in `src/routes/index.ts`.
- Update `src/auth/middleware.ts` if new endpoints need protection.
- Keep response shapes aligned with `@agenshield/ipc` types.
- Emit SSE events through `src/events/emitter.ts` for UI reactivity.

## Agent Notes
- `startServer()` starts the security watcher; remember to stop it on shutdown.
- The UI assets are served from `ui-assets` (prod) or `dist/apps/shield-ui` (dev).
- AgentLink tokens are stored in the vault; expect network calls to the MCP gateway.
- Config updates are persisted via `src/config/loader.ts` (JSON + Zod).
