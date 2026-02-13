# Watcher

Integrity monitor for deployed skills using `fs.watch()` for instant detection and polling as a fallback. Detects file modifications, deletions, and unexpected additions, then responds according to configurable policy. Also scans the skills directory for unregistered skills and quarantines them.

## Architecture

```
watcher/
  types.ts              # WatcherPolicy, WatcherAction, WatcherOptions
  watcher.service.ts    # SkillWatcherService (poll loop + response logic)
  index.ts
```

## Usage

```typescript
import { SkillWatcherService } from '@agentshield/skills';

const watcher = new SkillWatcherService(skillsRepo, deployService, emitter, {
  pollIntervalMs: 30_000,
  defaultPolicy: { onModified: 'quarantine', onDeleted: 'quarantine' },
  skillsDir: '/path/to/skills',
  quarantineDir: '/path/to/quarantine/skills',
  installationPolicies: {
    'critical-install-id': { onModified: 'quarantine', onDeleted: 'reinstall' },
  },
});

watcher.start();  // begins polling
watcher.stop();   // stops polling
await watcher.poll();  // single scan cycle
```

## Public API

### `SkillWatcherService`

| Method / Property | Signature | Description |
|---|-----------|-------------|
| `start` | `() => void` | Start the polling loop and filesystem watcher |
| `stop` | `() => void` | Stop the polling loop and filesystem watcher |
| `poll` | `() => Promise<void>` | Execute a single integrity scan cycle |
| `scanForNewSkills` | `() => void` | Scan skills directory for unregistered skills and quarantine them |
| `isRunning` | `boolean` (getter) | Whether the watcher is currently running |
| `resolvePolicy` | `(installationId: string) => ResolvedWatcherPolicy` | Get the effective policy for an installation (per-install overrides merged with defaults) |
| `setInstallationPolicy` | `(id: string, policy: Partial<WatcherPolicy>) => void` | Set a per-installation policy override |
| `removeInstallationPolicy` | `(id: string) => void` | Remove a per-installation policy override |
| `setScanCallbacks` | `(cbs: SkillScanCallbacks) => void` | Set callbacks for filesystem scan events |
| `suppressSlug` | `(slug: string) => void` | Suppress fs.watch events for a slug during external disk operations |
| `unsuppressSlug` | `(slug: string) => void` | Release slug suppression (delayed by `fsScanDebounceMs * 2` to let events settle) |

## Coordination with SkillManager

`SkillManager.install()` and `uninstall()` automatically suppress the watcher for the affected slug during their disk operations, preventing false integrity violations or new-skill scans from the watcher's `fs.watch`.

External callers doing direct filesystem operations on deployed skill directories should call `suppressSlug` / `unsuppressSlug` manually:

```typescript
watcher.suppressSlug('my-skill');
try {
  // perform filesystem operations in skillsDir/my-skill/
} finally {
  watcher.unsuppressSlug('my-skill');
}
```

`unsuppressSlug` releases suppression after a delay (`fsScanDebounceMs * 2`) to allow any pending `fs.watch` events to drain before the slug becomes active again.

## Policies

| Action | Behavior |
|--------|----------|
| `quarantine` | Sets installation status to `quarantined` in DB + removes folder from disk (moves to `quarantineDir` if configured, otherwise deletes) |
| `reinstall` | Re-deploys the skill from the registered version files |

When both modified and deleted files are detected, the stricter action is chosen (quarantine > reinstall).

## Filesystem Watch (Instant Detection)

When `start()` is called, the watcher uses Node.js `fs.watch()` with `{ recursive: true }` to monitor the entire `skillsDir` tree. This provides near-instant detection (~500ms) of both new skills dropped on disk and file modifications inside existing skill directories, without waiting for the next 30s poll cycle.

- **Recursive**: Watches the entire `skillsDir` tree, detecting new directories AND file changes inside existing skill directories.
- **Debounce per slug**: Events are debounced per skill slug (first path segment), batching multiple file writes within the same skill directory into a single check (default 500ms, configurable via `fsScanDebounceMs`).
- **Routing**: For installed skills (slug has an active installation), file changes trigger a targeted integrity check (SHA comparison via `DeployService.checkIntegrity()`). For unregistered slugs, triggers `scanForNewSkills()`.
- **`persistent: false`**: The FSWatcher does not keep the Node.js process alive.
- **Slug suppression**: During our own disk operations (quarantine removal, reinstall writes), the affected slug is suppressed so fs.watch events from those operations are ignored. Suppression is released after `fsScanDebounceMs * 2` to let events settle.
- **Graceful fallback**: If `fs.watch()` is unavailable or errors, polling remains the sole detection mechanism. No errors are logged — the fallback is silent.

## Poll Cycle

Each `poll()` call:

1. Runs `scanForNewSkills()` to detect unregistered skills on disk
2. Runs `deployer.checkAllIntegrity()` across all active installations
3. For each violation, resolves the effective policy and determines the action
4. **Quarantine**: Updates installation status in DB + removes tampered folder from disk (moves to `quarantineDir` if configured, otherwise deletes)
5. **Reinstall**: Looks up the installation by ID via `getInstallationById()` (direct PK lookup), then re-deploys via `deployer.deploy()`
6. Emits events for each violation and action taken

## Filesystem Scan (New Skill Detection)

`scanForNewSkills()` detects any skill directory in `skillsDir` that lacks an active `skill_installations` record:

1. For each directory in `skillsDir`:
   - Look up skill by slug in DB
   - If skill exists, check if ANY version has an active installation
   - If active installation found → skip (properly installed)
2. For unregistered skills:
   - Read `_meta.json` for metadata (falls back to directory name + `0.0.0`)
   - Collect and hash all files recursively (skips hidden directories)
   - Compute content hash from sorted file hashes
   - Deduplicate: skip if already quarantined with same content hash
   - Create skill record if it doesn't exist (source: `watcher`)
   - Create quarantined version (`approval: 'quarantined'`, `analysisStatus: 'pending'`)
   - Register files in DB with hashes
   - Move directory to `quarantineDir/{slug}` if configured, otherwise delete from `skillsDir`
   - Emit `watcher:skill-detected` event + `onQuarantined` callback

## Events

| Event | Description |
|-------|-------------|
| `watcher:started` | Polling loop started |
| `watcher:stopped` | Polling loop stopped |
| `watcher:poll-started` | Single poll cycle started |
| `watcher:poll-completed` | Single poll cycle finished |
| `watcher:integrity-violation` | File tampering detected on an installed skill |
| `watcher:quarantined` | Installation quarantined due to integrity violation |
| `watcher:reinstalled` | Installation reinstalled after integrity violation |
| `watcher:skill-detected` | Unregistered skill found on disk and quarantined |
| `watcher:action-error` | Error while executing quarantine/reinstall action |
| `watcher:error` | General watcher error |

## Types

```typescript
type WatcherAction = 'reinstall' | 'quarantine';

interface WatcherPolicy {
  onModified: WatcherAction;
  onDeleted: WatcherAction;
}

interface WatcherOptions {
  pollIntervalMs?: number;            // Default: 30_000
  defaultPolicy?: Partial<WatcherPolicy>;
  installationPolicies?: Record<string, Partial<WatcherPolicy>>;
  skillsDir?: string;                 // Directory to scan for skills
  quarantineDir?: string;             // Directory to move unregistered skills
  fsScanDebounceMs?: number;          // Default: 500
}
```
