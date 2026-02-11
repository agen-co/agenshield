# Watcher

Polling-based integrity monitor for deployed skills. Detects file modifications, deletions, and unexpected additions, then responds according to configurable policy.

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
| `start` | `() => void` | Start the polling loop |
| `stop` | `() => void` | Stop the polling loop |
| `poll` | `() => Promise<void>` | Execute a single integrity scan cycle |
| `isRunning` | `boolean` (getter) | Whether the watcher is currently running |
| `resolvePolicy` | `(installationId: string) => ResolvedWatcherPolicy` | Get the effective policy for an installation (per-install overrides merged with defaults) |
| `setInstallationPolicy` | `(id: string, policy: Partial<WatcherPolicy>) => void` | Set a per-installation policy override |
| `removeInstallationPolicy` | `(id: string) => void` | Remove a per-installation policy override |

## Policies

| Action | Behavior |
|--------|----------|
| `quarantine` | Sets installation status to `quarantined` in DB |
| `reinstall` | Re-deploys the skill from the registered version files |

When both modified and deleted files are detected, the stricter action is chosen (quarantine > reinstall).

## Poll Cycle

Each `poll()` call:

1. Runs `deployer.checkAllIntegrity()` across all active installations
2. For each violation, resolves the effective policy and determines the action
3. **Quarantine**: Updates installation status in the DB
4. **Reinstall**: Looks up the installation by ID via `getInstallationById()` (direct PK lookup), then re-deploys via `deployer.deploy()`
5. Emits events for each violation and action taken

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
}
```
