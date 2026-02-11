# Update Service

Auto-update management for marketplace skills. Checks for newer versions and propagates updates to installations with auto-update enabled.

## Data Flow

```mermaid
graph LR
    CU[checkForUpdates] --> QR[Query Remote for Each Skill]
    QR --> CR[Compare Versions]
    CR --> R[Return UpdateCheckResult[]]

    PU[propagateUpdate] --> GA[Get Auto-Updatable Installations]
    GA --> UV[Update Version for Each]

    AP[applyPendingUpdates] --> CU
    CU --> DL[Download New Versions]
    DL --> PU
```

## Public API

| Method | Signature | Description |
|--------|-----------|-------------|
| `checkForUpdates` | `() => Promise<UpdateCheckResult[]>` | Query remote for newer versions |
| `propagateUpdate` | `(skillId: string, newVersionId: string) => UpdateResult` | Update auto-updatable installations (scope-aware) |
| `applyPendingUpdates` | `() => Promise<UpdateResult[]>` | Check + download + propagate all updates |

## Version Pinning

Installations with `pinnedVersion` set are excluded from auto-updates. Use `InstallService.pinVersion()` / `unpinVersion()` to manage pins.

## Scope Awareness

`propagateUpdate()` calls `getAutoUpdatable(skillId)` on the underlying `SkillsRepository`. When the repository is scoped (via `storage.for(scope).skills`), only installations matching the scope hierarchy are updated:

- **Global** installations (no target, no user) — always included
- **Target-level** installations (matching `targetId`, no user) — if scope has `targetId`
- **User-level** installations (matching `targetId` + `userUsername`) — if scope has both

Unscoped repositories update all eligible installations (backward compatible).
