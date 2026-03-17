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
| `libs/cloud` | `libs/cloud/README.md` (full API reference with Mermaid architecture diagrams) |

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
- `libs/cloud/src/errors.ts` — `CloudError` (base with `.code`), `CloudConnectionError`, `CloudAuthError`, `CloudEnrollmentError`, `CloudCommandError`

## macOS Native App (`apps/shield-macos`)

**Build command**: `yarn build:native` (runs `xcodebuild` via Nx)

When adding new Swift files to the Xcode project, you must manually update `apps/shield-macos/AgenShield.xcodeproj/project.pbxproj` in 4 places:

1. **PBXBuildFile section** — Add a build file entry with ID prefix `A1` (e.g., `A100002C`)
2. **PBXFileReference section** — Add a file reference with ID prefix `A2` (e.g., `A200002C`)
3. **PBXGroup children** — Add the file reference ID to the appropriate group (e.g., `A9000002` for the AgenShield group)
4. **PBXSourcesBuildPhase files** — Add the build file ID to the `AA000001` Sources build phase

ID convention: Build file IDs use `A1XXXXXX`, file reference IDs use `A2XXXXXX`. Increment from the last used ID in each section.

## SEA (Single Executable Application) Binaries

The project builds 3 SEA binaries: CLI (`agenshield`), Daemon (`agenshield-daemon`), Broker (`agenshield-broker`).

### Build commands

- **Full production build** (local): `yarn build:prod` — sets Apple codesign env vars, builds native app + all SEA binaries
- **Individual binary** (dev): `npx nx bundle cli-bin && npx nx build cli-bin`
- **All binaries** (script): `node --experimental-strip-types tools/sea/build-all.mts [options]`

### How it works

1. **esbuild** bundles each app's TypeScript into a single CJS file
2. `node --experimental-sea-config` generates a SEA blob from the CJS bundle
3. The blob is injected into a copy of the Node.js binary via platform-specific patching
4. The binary is code-signed (macOS) and validated

### Adding new workspace libraries

When extracting or creating a new `libs/*` library, you **must** add its path alias to `tools/sea/shared/constants.mts` in the `ALIASES` map. Without this, esbuild cannot resolve the import and the SEA bundle will fail.

```typescript
// tools/sea/shared/constants.mts — ALIASES map
'@agenshield/new-lib': path.join(ROOT, 'libs/new-lib/src/index.ts'),
```

### macOS Mach-O injection (Node.js v24)

The custom Mach-O patcher in `tools/sea/shared/build-helpers.mts` (`addMachOSection`) bypasses postject/LIEF because Node.js v24 has duplicate sentinel strings that break postject's uniqueness check.

Critical invariants:
- **Section name**: Must be `__NODE_SEA_BLOB` (with `__` prefix). Node.js v24 uses `getsectdata("NODE_SEA", "__NODE_SEA_BLOB")` — the double underscore follows Mach-O section naming convention.
- **vmaddr = fileoff + \_\_PAGEZERO.vmsize**: Node.js uses `getsectdata()` which returns `header_address + section.offset`. For this pointer to be valid, the segment must satisfy `vmaddr == fileoff + __PAGEZERO.vmsize`. The blob insertion point is padded to avoid overlap with `__DATA`'s BSS region.
- **\_\_LINKEDIT must be last** in file layout — `codesign` rejects binaries with data after `__LINKEDIT`.
- After inserting the blob, `__LINKEDIT` is shifted forward in **both** file offset and vmaddr, and all referencing load commands (LC_SYMTAB, LC_DYSYMTAB, LC_CODE_SIGNATURE, etc.) are updated.

### macOS code signing

`resolveCodesignIdentity()` in `build-helpers.mts` resolves the signing identity in this order:
1. Explicit `--codesign-identity` flag
2. `AGENSHIELD_CODESIGN_IDENTITY` env var
3. `APPLE_TEAM_ID` + `APPLE_CODESIGN_ORG` env vars → `"Developer ID Application: $ORG ($TEAM_ID)"`
4. Auto-detect first "Developer ID Application" identity from keychain
5. Ad-hoc signing (`--sign -`) as last resort

For local development with SentinelOne or similar endpoint security, the binary **must** be signed with a real Developer ID certificate — ad-hoc signing will be blocked. Ensure your Frontegg LTD certificate is in the keychain.

### GitHub Actions secrets

**Code signing (CI + release)** — needed so SEA binaries and AgenShield.app are signed with the Frontegg Developer ID:

| Secret | Value |
|--------|-------|
| `APPLE_CERTIFICATE_P12_BASE64` | Base64-encoded `.p12` export of "Developer ID Application: Frontegg LTD (3R2X6557U2)" cert + private key. Export from Keychain Access, then `base64 -i cert.p12 \| pbcopy`. |
| `APPLE_CERTIFICATE_PASSWORD` | Password set when exporting the `.p12` |
| `APPLE_TEAM_ID` | `3R2X6557U2` |
| `APPLE_CODESIGN_ORG` | `Frontegg LTD` |

**Notarization (release workflow only)** — needed so published binaries pass Gatekeeper on end-user machines:

| Secret | Value |
|--------|-------|
| `APPLE_API_KEY_P8_BASE64` | Base64-encoded App Store Connect API `.p8` key file |
| `APPLE_API_KEY_ID` | API key ID from App Store Connect |
| `APPLE_API_ISSUER_ID` | Issuer UUID from App Store Connect |
