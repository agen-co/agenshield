# @agenshield/ipc

Shared types, schemas, and constants for AgenShield components. This package is the contract between the broker, daemon, CLI, UI, and any external clients.

## Purpose
- Define canonical TypeScript types used across packages.
- Provide Zod schemas for validation and parsing.
- Export shared constants for ports, paths, and API endpoints.

## What It Contains
- Types: `src/types/*` (config, ops, auth, events, policy, vault, agentlink, state, api).
- Schemas: `src/schemas/*` (Zod validators mirroring the types).
- Constants: `src/constants.ts` (ports, paths, endpoints, MCP gateway).

## Usage
### Types
```ts
import type { ShieldConfig, OperationType, AuthStatusResponse } from '@agenshield/ipc';
```

### Schemas
```ts
import { ShieldConfigSchema } from '@agenshield/ipc';

const config = ShieldConfigSchema.parse(jsonData);
```

### Constants
```ts
import { DEFAULT_PORT, API_PREFIX, SSE_ENDPOINTS } from '@agenshield/ipc';
```

## Limitations and Caveats
- This package is schema/type-only; it does not perform I/O or runtime orchestration.
- Zod schemas validate structure but not environment- or host-specific semantics.
- If you add new fields, you must update both type definitions and schemas to stay in sync.

## Roadmap (Ideas)
- Generate OpenAPI definitions from Zod schemas.
- Formal versioning for backward/forward compatibility.
- Centralized type tests to ensure schema and types remain aligned.

## Development
```bash
# Build
npx nx build shield-ipc
```

## Contribution Guide
- Add new types under `src/types/` and export them in `src/types/index.ts`.
- Add matching Zod schemas under `src/schemas/` and export them in `src/index.ts`.
- Update `src/constants.ts` only when a cross-package constant is needed.

## Agent Notes
- `src/index.ts` is the public API surface. Keep it clean and deliberate.
- Schema changes should be reflected in dependent packages (`@agenshield/daemon`, `@agenshield/broker`, `@agenshield/sandbox`).
- Keep constants stable; changing default paths/ports can break local assumptions.
