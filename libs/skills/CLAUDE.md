# Skills Library — Coding Agent Guide

## Architecture Overview

`SkillManager` is a **facade** over composed sub-services. It does not inherit from them — it delegates. Each service owns a single domain (download, install, deploy, etc.) and communicates via the shared `SkillsRepository` and Node.js `EventEmitter`.

Key dependency chain: `SkillManager` → services → `SkillsRepository` (from `@agenshield/storage`) + adapters.

## File Organization

Each domain lives in its own folder under `src/`:

```
src/{domain}/
  {domain}.service.ts   # Core service class
  types.ts              # Domain-specific types/interfaces
  index.ts              # Barrel exports
  adapters/             # (optional) Adapter implementations
    {name}.adapter.ts
    index.ts
  README.md             # Module documentation
```

Top-level files:
- `manager.ts` — SkillManager facade
- `errors.ts` — All typed error classes (zero internal imports)
- `events.ts` — SkillEvent union type
- `index.ts` — Library barrel

## How to Add a New Service

1. Create `src/{domain}/` with `service.ts`, `types.ts`, `index.ts`
2. Service constructor takes `SkillsRepository` + any dependencies
3. Accept `EventEmitter` to emit `SkillEvent` instances
4. Wire into `SkillManager` constructor in `manager.ts`
5. Add convenience methods on `SkillManager` if needed
6. Export from the library barrel (`src/index.ts`)
7. Create `README.md` in the domain folder

## How to Add a New Adapter

1. Define an interface in the service's `types.ts`
2. Create `adapters/{name}.adapter.ts` implementing the interface
3. Register via `SkillManagerOptions` — no changes to existing services
4. Export from domain and library barrels

## Error Conventions

- All errors live in `src/errors.ts` and extend `SkillsError`
- **Never** throw bare `new Error(...)` — always use a typed error class
- Include contextual properties (IDs, slugs, status codes) on the error class
- Add `.code` string for programmatic error handling
- Export new error classes from `src/index.ts`

## Event Conventions

- Emit via `this.emitter.emit('skill-event', event)` where `emitter` is the `EventEmitter` passed from `SkillManager`
- Add new event types to the `SkillEvent` union in `src/events.ts`
- Include `operationId` (UUID) for tracing multi-step operations
- Use `ProgressInfo` for step-by-step progress tracking
- Category naming: `{domain}:{action}` (e.g., `download:started`, `deploy:error`)

## Testing Patterns

- **Real SQLite + real filesystem** in temp dirs — no mocking the DB
- `createTestDb()` helper from test utils for in-memory databases
- `jest.useFakeTimers()` for timer-based tests (watcher polling)
- `jest.useRealTimers()` for filesystem-based tests
- `jest.isolateModules` + `jest.doMock('node:fs')` for fs mocking
- Tests go in `src/__tests__/{service}.spec.ts` or `src/{domain}/__tests__/`

## Key Dependencies

| Package | Usage |
|---------|-------|
| `@agenshield/storage` | `SkillsRepository` for all DB operations |
| `@agenshield/ipc` | Shared types (`Skill`, `SkillVersion`, `EventBus`, etc.) |
| `node:events` | `EventEmitter` for internal event passing |
| `node:crypto` | SHA-256 hashing for content verification |

## Important Rules

- **No dynamic imports**: Always use static imports. `errors.ts` has no internal dependencies — there is no circular dependency risk.
- **No bare Error**: Use typed errors from `errors.ts`.
- **Adapter interfaces in types.ts**: Keep adapter contracts in the domain's `types.ts`, implementations in `adapters/`.
- **Watcher suppression**: When doing disk operations on deployed skills, call `watcher.suppressSlug()` / `unsuppressSlug()` to prevent false integrity violations.

## Run Tests

```bash
npx jest --config libs/skills/jest.config.ts --rootDir libs/skills --coverage
```
