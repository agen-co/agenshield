# AgenShield — Project Conventions

## Documentation

Every library under `libs/` has README files that document the public API, architecture, and usage. When modifying a library, **update the relevant README files** if the change affects:

- Public API surface (new/changed/removed methods, types, or exports)
- Architecture or data flow (new services, adapters, dependencies between components)
- Scoping behavior or query semantics
- Error classes or event types
- Configuration options or constructor signatures

README locations:

| Library | README files |
|---------|-------------|
| `libs/storage` | `libs/storage/README.md` (full API reference) |
| `libs/skills` | `libs/skills/src/README.md` (root), plus per-domain: `analyze/`, `catalog/`, `deploy/`, `install/`, `update/`, `upload/`, `watcher/` each have their own `README.md` |
| `libs/shield-interceptor` | `libs/shield-interceptor/README.md` |

## Error Handling

All libraries MUST define typed error classes in a dedicated `errors.ts` file at the library root (`libs/{name}/src/errors.ts`).

Rules:
- **Never** throw bare `new Error(...)` in production code. Always use a typed error class.
- Each library has a base error class (e.g. `SkillsError`, `StorageLockedError`) that extends `Error`.
- Subclasses extend the base and set `.name` and `.code` properties.
- Include `Error.captureStackTrace?.(this, this.constructor)` in the base class constructor.
- Add contextual properties (IDs, slugs, status codes) to error classes — don't encode them only in the message string.
- Export all error classes from the library barrel (`index.ts`).

Existing patterns:
- `libs/storage/src/errors.ts` — `StorageLockedError`, `ValidationError`, `PasscodeError`
- `libs/shield-interceptor/src/errors.ts` — `AgenShieldError` (base with `.code`), `PolicyDeniedError`, `TimeoutError`
- `libs/skills/src/errors.ts` — `SkillsError` (base with `.code`), `SkillNotFoundError`, `RemoteApiError`, `AnalysisError`

## macOS Native App (`apps/shield-macos`)

**Build command**: `yarn build:native` (runs `xcodebuild` via Nx)

When adding new Swift files to the Xcode project, you must manually update `apps/shield-macos/AgenShield.xcodeproj/project.pbxproj` in 4 places:

1. **PBXBuildFile section** — Add a build file entry with ID prefix `A1` (e.g., `A100002C`)
2. **PBXFileReference section** — Add a file reference with ID prefix `A2` (e.g., `A200002C`)
3. **PBXGroup children** — Add the file reference ID to the appropriate group (e.g., `A9000002` for the AgenShield group)
4. **PBXSourcesBuildPhase files** — Add the build file ID to the `AA000001` Sources build phase

ID convention: Build file IDs use `A1XXXXXX`, file reference IDs use `A2XXXXXX`. Increment from the last used ID in each section.
