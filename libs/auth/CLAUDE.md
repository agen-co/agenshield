# Auth Library Conventions

## Module Architecture

The auth library is organized as flat modules (not domain folders), each with a single responsibility:

```
src/
├── secret.ts       # JWT HMAC key — load, generate, cache, clear
├── sign.ts         # JWT signing — admin (30m TTL) and broker (no expiry)
├── verify.ts       # JWT verification — safe (result) and throwing variants
├── middleware.ts    # Fastify preHandler hook — token extraction, route matching
├── roles.ts        # Role hierarchy, PUBLIC_ROUTES, ADMIN_ONLY_ROUTES
├── sudo-verify.ts  # macOS dscl password check with in-memory rate limiter
├── cloud-auth.ts   # Ed25519 keypair, AgentSig headers, credential storage, device code flow
├── mdm-config.ts   # MDM org config read/write (~/.agenshield/mdm.json)
├── errors.ts       # AuthError base + 6 typed subclasses
├── types.ts        # Shared interfaces and type aliases
└── index.ts        # Barrel export
```

## Error Handling

- Base class: `AuthError extends Error` with `.code` string
- All subclasses set `.name` and `.code` in constructor
- `Error.captureStackTrace?.(this, this.constructor)` in `AuthError` constructor
- Contextual properties on subclasses (e.g., `requiredRole`, `retryAfterMs`, `username`, `agentId`)
- Never throw bare `new Error(...)` — always use a typed error class

## JWT Flow

1. `loadOrCreateSecret()` must be called before any sign/verify operation
2. `getSecret()` returns the cached key; throws if not initialized
3. `signAdminToken()` / `signBrokerToken()` use `jose.SignJWT` with HS256
4. `verifyToken()` returns `{ valid, payload?, error? }` — never throws
5. `verifyTokenOrThrow()` throws `TokenExpiredError` or `TokenInvalidError`

## Middleware Conventions

- `extractBearerToken()` checks Authorization header first, then `?token=` query param (for SSE)
- `createJwtAuthHook()` returns a Fastify `preHandler` async function
- Route matching: `isPublicRoute()` uses `startsWith`, `isAdminOnlyRoute()` uses `startsWith` for exact paths and regex for wildcard (`*`) paths
- The hook strips query strings before route matching
- Custom routes passed via `JwtAuthHookOptions` are additive to built-in routes

## Cloud Auth (Ed25519)

- Keypair: `generateKeyPairSync('ed25519')` with PEM SPKI/PKCS8 encoding
- AgentSig format: `AgentSig {agentId}:{timestamp}:{base64Signature}`
- Verification checks: parse → timestamp within 5 minutes → Ed25519 signature valid
- Credentials stored at `~/.agenshield/cloud.json` (mode `0o600`)
- Config paths resolve via: `AGENSHIELD_USER_HOME` → `HOME` → `os.homedir()`

## Sudo Verification

- macOS-only: uses `/usr/bin/dscl . -authonly <user> <pass>`
- In-memory rate limiter: 5 attempts per 15-minute sliding window
- Successful auth clears the attempt counter
- `getCurrentUsername()` detects console user when running as root (LaunchDaemon)
- `resetRateLimit()` exported for testing only

## Testing

- Tests live in `src/__tests__/*.spec.ts`
- Each source module has a corresponding test file
- Use temp directories for file-based tests (secret, cloud credentials, MDM config)
- Override `AGENSHIELD_USER_HOME` env for path isolation in tests
- Mock `node:child_process` for sudo-verify tests
- Mock `global.fetch` for device code flow tests
- Mock `../verify` module (via `jest.mock`) for middleware fallback branch testing
- Always call `clearSecretCache()` in afterEach to prevent test pollution
- Run with: `npx nx test auth --coverage`

## Adding New Functionality

- Add the module as a new `.ts` file in `src/`
- Export from `index.ts` barrel
- Define typed errors in `errors.ts` if the module can fail
- Add types to `types.ts` if shared across modules
- Create `src/__tests__/<module>.spec.ts` with 100% coverage target
- If the module reads/writes files, use `AGENSHIELD_USER_HOME` for path resolution
