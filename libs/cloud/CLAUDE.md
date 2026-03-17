# Cloud Library Conventions

## Module Architecture

The cloud library is organized as flat modules (not domain folders), each with a single responsibility:

```
src/
├── auth.ts         # Ed25519 keypair generation, AgentSig header create/parse/verify
├── config.ts       # CLOUD_CONFIG constants (paths, timeouts, endpoints)
├── credentials.ts  # Cloud credential storage (~/.agenshield/cloud.json)
├── device-code.ts  # OAuth device code flow (initiate, poll, register)
├── mdm-config.ts   # MDM org config read/write (~/.agenshield/mdm.json)
├── cloud-client.ts # WebSocket/HTTP transport layer (CloudClient)
├── enrollment.ts   # EnrollmentProtocol state machine (device code → registration)
├── errors.ts       # CloudError base + 4 typed subclasses
├── types.ts        # Shared interfaces and type aliases
└── index.ts        # Barrel export
```

## Error Handling

- Base class: `CloudError extends Error` with `.code` string
- All subclasses set `.name` and `.code` in constructor
- `Error.captureStackTrace?.(this, this.constructor)` in `CloudError` constructor
- Contextual properties on subclasses (e.g., `cloudUrl`, `agentId`, `retryable`, `method`)
- Never throw bare `new Error(...)` — always use a typed error class

Error classes:
- `CloudConnectionError` — WebSocket or HTTP connection failure
- `CloudAuthError` — agent-to-cloud authentication failure (invalid AgentSig, expired timestamp)
- `CloudEnrollmentError` — device enrollment failure (with `retryable` flag)
- `CloudCommandError` — cloud command execution failure

### CloudAuthError duplication note

`CloudAuthError` exists in both `@agenshield/cloud` and `@agenshield/auth`:
- `@agenshield/cloud` — `CloudAuthError extends CloudError` (cloud transport domain)
- `@agenshield/auth` — `CloudAuthError extends AuthError` (JWT auth domain)

Both are intentional. They serve different base class hierarchies and different error domains. Cloud consumers should use `@agenshield/cloud`'s version; JWT/middleware consumers use `@agenshield/auth`'s version.

## Public API Surface

- **Auth primitives**: `generateEd25519Keypair`, `createAgentSigHeader`, `parseAgentSigHeader`, `verifyAgentSig`
- **Credentials**: `saveCloudCredentials`, `loadCloudCredentials`, `isCloudEnrolled`
- **MDM config**: `loadMdmConfig`, `saveMdmConfig`, `hasMdmConfig`
- **Device code flow**: `initiateDeviceCode`, `pollDeviceCode`, `registerDevice`
- **Transport**: `CloudClient` (WebSocket reconnection, command handling, heartbeat)
- **Enrollment**: `EnrollmentProtocol` (state machine orchestrating device code → registration)
- **Config**: `CLOUD_CONFIG` (paths, timeouts, endpoint constants)

## Backward Compatibility

`@agenshield/auth` re-exports cloud auth primitives and credential functions from this library for backward compatibility. New code should import directly from `@agenshield/cloud`.

## Testing

- Tests live in `src/__tests__/*.spec.ts`
- Use temp directories for file-based tests (credentials, MDM config)
- Override `AGENSHIELD_USER_HOME` env for path isolation in tests
- Mock `global.fetch` for device code flow tests
- Run with: `npx nx test cloud --coverage`

## Adding New Functionality

- Add the module as a new `.ts` file in `src/`
- Export from `index.ts` barrel
- Define typed errors in `errors.ts` if the module can fail
- Add types to `types.ts` if shared across modules
- Create `src/__tests__/<module>.spec.ts`
- If the module reads/writes files, use `AGENSHIELD_USER_HOME` for path resolution
