# @agenshield/storage

SQLite-based persistent storage for AgenShield with column-level encryption, multi-tenant scoping, and automatic migrations.

Built on **better-sqlite3** (WAL mode), **Zod** validation, and **AES-256-GCM** encryption.

## Quick Start

### Direct use

```typescript
import { Storage } from '@agenshield/storage';

const storage = Storage.open('/path/to/agenshield.db');

// Use repositories
const state = storage.state.get();
const policies = storage.policies.getAll();

// Close when done
storage.close();
```

### Singleton pattern

```typescript
import { initStorage, getStorage, closeStorage } from '@agenshield/storage';

// Initialize once at startup
initStorage('/path/to/agenshield.db');

// Access anywhere
const storage = getStorage();
storage.policies.getAll();

// Shutdown
closeStorage();
```

Migrations run automatically on `Storage.open()` / `initStorage()`.

## Repositories

### Global repositories

Access via `storage.<property>`. Not scopeable.

| Property | Repository | Purpose |
|---|---|---|
| `state` | `StateRepository` | Singleton system state (daemon, AgenCo, installation, passcode) |
| `commands` | `CommandsRepository` | Allowed command allowlist |
| `targets` | `TargetRepository` | Target environments and user assignments |
| `activities` | `ActivityRepository` | Append-only event log with redaction |

### Scopeable repositories

Access via `storage.<property>` for base scope, or `storage.for(scope).<property>` for scoped access.

| Property | Repository | Scope Rule |
|---|---|---|
| `config` | `ConfigRepository` | **Merge** — NULL values inherit from parent level |
| `policies` | `PolicyRepository` | **Union** — additive across all scope levels |
| `vault` | `VaultRepository` | **Most-specific-wins** per secret name |
| `skills` | `SkillsRepository` | **Hierarchical** — global + matching target + target+user |
| `policyGraph` | `PolicyGraphRepository` | Nodes and edges filtered by scope |

## Scoped Access

Use `storage.for(scope)` to get a `ScopedStorage` instance with repositories pre-bound to a target/user scope.

```typescript
// Target-level scope
const targetStorage = storage.for({ targetId: 'my-target' });

// Target + user scope
const userStorage = storage.for({ targetId: 'my-target', userUsername: 'alice' });
```

### How scoping works

**Config (merge):** Reads base, target, and target+user configs. More specific levels override less specific ones. `NULL` values inherit from the parent level.

```typescript
// Base config has daemonPort=6969, logLevel='info'
// Target config has logLevel='debug', daemonPort=NULL
// Merged result: daemonPort=6969, logLevel='debug'
const config = storage.for({ targetId: 't1' }).config.get();
```

**Policies (union):** Returns the union of all policies from base + target + target+user scopes.

```typescript
// Returns base policies + target-specific policies
const policies = storage.for({ targetId: 't1' }).policies.getAll();
```

**Secrets (most-specific-wins):** For each secret name, the most specific scope wins (target+user > target > base).

```typescript
// If 'API_KEY' exists at base and target level, target-level value is returned
const secret = storage.for({ targetId: 't1' }).vault.getSecretByName({ name: 'API_KEY' });
```

**Skills (hierarchical):** Installation queries return global + matching hierarchy levels:

```typescript
// Returns: global installs + target 't1' installs (not t2, not t1+otherUser)
const installs = storage.for({ targetId: 't1' }).skills.getInstallations();

// With user scope: global + t1 + t1+alice (not t1+bob)
const userInstalls = storage.for({ targetId: 't1', userUsername: 'alice' }).skills.getInstallations();

// getInstallationById() is NOT scope-filtered (direct PK lookup)
const inst = storage.for({ targetId: 't1' }).skills.getInstallationById('some-id');
```

Scope-aware methods: `getInstallations()`, `getAutoUpdatable()`, `getInstalledSkills()`.

**Unscoped** access (`storage.config`, `storage.policies`, etc.) returns base-level data only.

## Passcode & Encryption

Only vault data is encrypted. All other repositories work without a passcode.

### First-time setup

```typescript
storage.setPasscode('my-secret');
// Sets passcode hash + auto-unlocks vault
```

### Unlock / Lock

```typescript
const success = storage.unlock('my-secret'); // true if correct
storage.lock(); // clears key from memory
```

### Change passcode

```typescript
storage.changePasscode('old-secret', 'new-secret');
// Re-encrypts all vault secrets and KV entries with the new key
```

### Status checks

```typescript
storage.hasPasscode(); // true if passcode has been set
storage.isUnlocked();  // true if vault is currently unlocked
```

### Encryption details

- **Key derivation:** scrypt from passcode + random salt
- **Cipher:** AES-256-GCM with per-value IV
- **Scope:** Column-level encryption on `vault_secrets.value_encrypted` and `vault_kv.value_encrypted`

## Read-Only / Unauthenticated Access

All non-vault repositories work without a passcode:

```typescript
storage.config.get();       // always available
storage.policies.getAll();  // always available
storage.state.get();        // always available
storage.commands.getAll();  // always available
```

Vault operations throw `StorageLockedError` when locked:

```typescript
import { StorageLockedError } from '@agenshield/storage';

try {
  storage.vault.getAllSecrets();
} catch (err) {
  if (err instanceof StorageLockedError) {
    // Prompt for passcode
  }
}
```

## Repository API Reference

### StateRepository

Global singleton system state.

```typescript
storage.state.get(): SystemState | null
storage.state.init(version: string): void
storage.state.updateDaemon(input: UpdateDaemonInput): void
storage.state.updateAgenCo(input: UpdateAgenCoInput): void
storage.state.updateInstallation(input: UpdateInstallationInput): void
storage.state.updatePasscode(input: UpdatePasscodeInput): void
storage.state.updateVersion(version: string): void
```

### ConfigRepository

Scoped configuration with cascading merge.

```typescript
storage.config.get(): ConfigData | null           // merged across scope levels
storage.config.getRaw(): ConfigData | null         // exact scope level only
storage.config.set(data: ConfigData): void
storage.config.delete(): boolean
```

### PolicyRepository

Scoped policy management with preset seeding.

```typescript
storage.policies.create(input: CreatePolicyInput): PolicyConfig
storage.policies.getById(id: string): PolicyConfig | null
storage.policies.getAll(): PolicyConfig[]
storage.policies.getEnabled(): PolicyConfig[]
storage.policies.update(id: string, input: UpdatePolicyInput): PolicyConfig | null
storage.policies.delete(id: string): boolean
storage.policies.deleteAll(): number
storage.policies.seedPreset(presetId: string): number
storage.policies.count(): number
```

### VaultRepository

Encrypted secrets and key-value store. All methods throw `StorageLockedError` when locked.

```typescript
// Secrets
storage.vault.createSecret(input: CreateSecretInput): VaultSecret
storage.vault.getSecret(id: string): VaultSecret | null
storage.vault.getSecretByName(params: { name: string }): VaultSecret | null
storage.vault.getAllSecrets(): VaultSecret[]
storage.vault.updateSecret(id: string, input: UpdateSecretInput): VaultSecret | null
storage.vault.deleteSecret(id: string): boolean

// Key-Value
storage.vault.setKv(params: { key: string; value: string }): void
storage.vault.getKv(params: { key: string }): string | null
storage.vault.deleteKv(params: { key: string }): boolean
```

### SkillsRepository

Skill registry with versions, files, and installations. Installation queries are scope-aware when accessed via `storage.for(scope).skills`.

```typescript
// Skills
storage.skills.create(input: CreateSkillInput): Skill
storage.skills.getById(id: string): Skill | null
storage.skills.getBySlug(slug: string): Skill | null
storage.skills.getByRemoteId(remoteId: string): Skill | null
storage.skills.getAll(filter?: { source?: string }): Skill[]
storage.skills.update(id: string, input: UpdateSkillInput): Skill | null
storage.skills.delete(id: string): boolean
storage.skills.search(query: string): Skill[]

// Versions
storage.skills.addVersion(input: CreateSkillVersionInput): SkillVersion
storage.skills.getVersion(params: { skillId: string; version: string }): SkillVersion | null
storage.skills.getVersionById(id: string): SkillVersion | null
storage.skills.getVersions(skillId: string): SkillVersion[]
storage.skills.getLatestVersion(skillId: string): SkillVersion | null
storage.skills.updateAnalysis(versionId: string, input: UpdateSkillVersionAnalysisInput): void
storage.skills.approveVersion(versionId: string): void
storage.skills.quarantineVersion(versionId: string): void

// Files
storage.skills.registerFiles(params: { versionId: string; files: FileInput[] }): SkillFile[]
storage.skills.getFiles(versionId: string): SkillFile[]
storage.skills.updateFileHash(params: { fileId: string; newHash: string }): void
storage.skills.recomputeContentHash(versionId: string): string

// Installations (scope-aware: getInstallations, getAutoUpdatable, getInstalledSkills)
storage.skills.install(input: CreateSkillInstallationInput): SkillInstallation
storage.skills.uninstall(installationId: string): boolean
storage.skills.getInstallationById(id: string): SkillInstallation | null  // NOT scope-filtered
storage.skills.getInstallations(filter?: SkillInstallationsFilter): SkillInstallation[]
storage.skills.getAutoUpdatable(skillId: string): SkillInstallation[]
storage.skills.updateInstallationStatus(id: string, input: { status: string }): void
storage.skills.setAutoUpdate(installationId: string, enabled: boolean): void
storage.skills.updateInstallationVersion(installationId: string, newVersionId: string): void
storage.skills.updateWrapperPath(installationId: string, wrapperPath: string): void
storage.skills.pinVersion(installationId: string, version: string): void
storage.skills.unpinVersion(installationId: string): void
storage.skills.getInstalledSkills(): Array<Skill & { version: SkillVersion }>
```

### ActivityRepository

Append-only event log with redaction and pruning.

```typescript
storage.activities.append(input: CreateActivityEventInput): ActivityEvent
storage.activities.getAll(opts?: { targetId?: string; type?: string; since?: string; limit?: number; offset?: number }): ActivityEvent[]
storage.activities.count(opts?: { targetId?: string; type?: string }): number
storage.activities.prune(maxEvents?: number): number
storage.activities.clear(): number
```

### CommandsRepository

Allowed command allowlist.

```typescript
storage.commands.create(input: CreateAllowedCommandInput): AllowedCommand
storage.commands.getByName(name: string): AllowedCommand | null
storage.commands.getAll(category?: string): AllowedCommand[]
storage.commands.delete(name: string): boolean
storage.commands.isAllowed(name: string): boolean
```

### TargetRepository

Target environments and user assignments.

```typescript
storage.targets.create(input: CreateTargetInput): Target
storage.targets.getById(id: string): Target | null
storage.targets.getAll(): Target[]
storage.targets.update(id: string, input: UpdateTargetInput): Target | null
storage.targets.delete(id: string): boolean
storage.targets.addUser(input: CreateTargetUserInput): TargetUser
storage.targets.removeUser(params: { targetId: string; userUsername: string }): boolean
storage.targets.getUsers(targetId: string): TargetUser[]
```

### PolicyGraphRepository

Conditional policy chaining as a directed acyclic graph.

```typescript
// Nodes
storage.policyGraph.createNode(input: CreatePolicyNodeInput): PolicyNode
storage.policyGraph.getNode(id: string): PolicyNode | null
storage.policyGraph.getNodeByPolicyId(policyId: string): PolicyNode | null
storage.policyGraph.getNodes(): PolicyNode[]
storage.policyGraph.updateNode(id: string, input: UpdateNodeInput): PolicyNode | null
storage.policyGraph.deleteNode(id: string): boolean

// Edges
storage.policyGraph.createEdge(input: CreatePolicyEdgeInput): PolicyEdge
storage.policyGraph.getEdge(id: string): PolicyEdge | null
storage.policyGraph.getEdgesFrom(sourceNodeId: string): PolicyEdge[]
storage.policyGraph.getEdgesTo(targetNodeId: string): PolicyEdge[]
storage.policyGraph.getAllEdges(): PolicyEdge[]
storage.policyGraph.updateEdge(id: string, input: UpdateEdgeInput): PolicyEdge | null
storage.policyGraph.deleteEdge(id: string): boolean
storage.policyGraph.validateAcyclic(params: { sourceId: string; targetId: string }): boolean

// Activations
storage.policyGraph.activate(params: { edgeId: string; expiresAt?: string; processId?: number }): EdgeActivation
storage.policyGraph.getActiveActivations(edgeId?: string): EdgeActivation[]
storage.policyGraph.consumeActivation(id: string): void
storage.policyGraph.expireByProcess(processId: number): void
storage.policyGraph.expireBySession(): void
storage.policyGraph.pruneExpired(): number

// Full graph
storage.policyGraph.loadGraph(): PolicyGraph
```

## Transactions

Wrap multiple operations in a SQLite transaction. Rolls back on throw.

```typescript
storage.transaction(() => {
  const policy = storage.policies.create({ ... });
  const node = storage.policyGraph.createNode({ policyId: policy.id, ... });
  storage.policyGraph.createEdge({ sourceNodeId: existingNodeId, targetNodeId: node.id, ... });
});
```

## Error Handling

| Error | When | Properties |
|---|---|---|
| `StorageLockedError` | Vault operation without unlock | `message` |
| `ValidationError` | Zod validation failure | `message`, `issues: unknown[]` |
| `StorageNotInitializedError` | `getStorage()` before `initStorage()` | `message` |
| `PasscodeError` | Duplicate `setPasscode()`, wrong current passcode | `message` |

```typescript
import { StorageLockedError, ValidationError, PasscodeError } from '@agenshield/storage';
```

## Migrations

Migrations run automatically on `Storage.open()` / `initStorage()`. They are applied in order within a single transaction.

| Version | Name | Description |
|---------|------|-------------|
| 1 | `001-initial-schema` | Core tables: state, config, policies, vault, skills, targets, activity, commands, policy graph |
| 2 | `002-import-json` | Import JSON data support |
| 3 | `003-skills-manager-columns` | Adds `remote_id`, `is_public` to skills; `auto_update`, `pinned_version` to installations |

### Version checking

```typescript
import { getDbVersion, getCurrentVersion } from '@agenshield/storage';

getDbVersion(db);      // Fast PRAGMA-based version check
getCurrentVersion(db); // Reads _migrations table
```

### Adding a new migration

Implement the `Migration` interface and add it to `ALL_MIGRATIONS` in `src/migrations/index.ts`:

```typescript
import type { Migration } from '@agenshield/storage';
import type Database from 'better-sqlite3';

export class MyMigration implements Migration {
  readonly version = 4;
  readonly name = '004-my-changes';

  up(db: Database.Database, encryptionKey: Buffer | null): void {
    db.exec(`ALTER TABLE ...`);
  }
}
```

## Database Details

- **Engine:** SQLite via better-sqlite3
- **Journal mode:** WAL (concurrent reads)
- **Foreign keys:** ON
- **Busy timeout:** 5000ms
- **File permissions:** `0o600` (database file), `0o700` (parent directory)
- **Default filename:** `agenshield.db`

## Project Structure

```
libs/storage/src/
├── storage.ts                  # Main Storage class + singleton
├── database.ts                 # Connection management + pragmas
├── crypto.ts                   # scrypt key derivation, AES-256-GCM
├── scoping.ts                  # Multi-tenant scope resolution
├── errors.ts                   # StorageLockedError, ValidationError, etc.
├── constants.ts                # DB_FILENAME, META_KEYS, pragmas
├── types.ts                    # DB row interfaces (snake_case)
├── index.ts                    # Public barrel export
├── migrations/
│   ├── types.ts                # Migration interface
│   ├── index.ts                # Runner + registry
│   ├── 001-initial-schema.ts
│   ├── 002-import-json.ts
│   └── 003-skills-manager-columns.ts
└── repositories/
    ├── base.repository.ts      # Abstract base (validation, encryption, IDs)
    ├── config/
    │   ├── config.schema.ts    # Zod schemas + codecs
    │   ├── config.model.ts     # Row mappers + types
    │   ├── config.query.ts     # SQL queries
    │   ├── config.repository.ts
    │   └── index.ts
    ├── policy/                 # Same structure as config/
    ├── vault/
    ├── skills/
    ├── state/
    ├── activity/
    ├── commands/
    ├── target/
    └── policy-graph/
```

Each repository domain follows the same file convention:

- **`schema.ts`** — Zod schemas, codecs, derived input types (source of truth for validation)
- **`model.ts`** — DB row to domain type mappers, constants
- **`query.ts`** — SQL queries as prepared statement factories
- **`repository.ts`** — Public CRUD API

See [CLAUDE.md](./CLAUDE.md) for contributor conventions.
