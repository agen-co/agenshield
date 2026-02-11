# Storage Library Conventions

## Repository Architecture

Each domain lives in its own folder under `src/repositories/`:

```
repositories/
  skills/
    skills.repository.ts   # CRUD operations, orchestrates schema + model + query
    skills.schema.ts        # Zod schemas (create, update) + codecs + derived types
    skills.model.ts         # Row mappers, constants, interfaces
    skills.query.ts         # Raw SQL queries as prepared statement factories
    index.ts                # Barrel export
    __tests__/
      skills.repository.spec.ts
  target/
    target.repository.ts
    target.schema.ts
    target.model.ts
    target.query.ts
    index.ts
    __tests__/
      target.repository.spec.ts
  ...
```

### File Responsibilities

- **`*.schema.ts`** — Zod schemas for create/update inputs, Zod codecs for domain↔DB encoding, derived input types. Source of truth for validation.
- **`*.model.ts`** — DB row → domain type mappers, constants, interfaces. No Zod imports.
- **`*.query.ts`** — SQL query strings and prepared statement factories. No business logic.
- **`*.repository.ts`** — Public API. Orchestrates validation (schema), encoding (codec), mapping (model), queries (query), encryption (base), and transactions.

### Method Naming

Inside a domain repository, methods do NOT repeat the entity name:

```typescript
// GOOD — inside SkillsRepository:
create(input)
getById(id)
update(id, input)
delete(id)

// BAD:
createSkill(input)
updateSkill(id, input)
deleteSkill(id)
```

Sub-resources use their own prefix:
```typescript
// GOOD:
addVersion(input)
getVersion(skillId, version)
install(input)
uninstall(id)
```

### Update Schemas & Codecs

Every update operation uses a dedicated Zod schema + codec (never `Partial<Pick<...>>` or `if (data.x !== undefined)` chains):

```typescript
// In skills.schema.ts:
export const UpdateSkillSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  author: z.string().max(200).optional(),
  ...
});
export type UpdateSkillInput = z.input<typeof UpdateSkillSchema>;

// Codec: domain (camelCase) → DB params (snake_case, serialized)
export const UpdateSkillCodec = z.codec(
  z.record(z.string(), z.unknown()),
  UpdateSkillSchema,
  {
    decode: (db) => db as UpdateSkillInput,
    encode: (data) => ({
      name: data.name,
      author: data.author,
      tags: data.tags !== undefined ? JSON.stringify(data.tags) : undefined,
      // ... boolean → int, camelCase → snake_case
    }),
  }
);
```

The repository uses: `codec.encode(validated)` → `this.buildDynamicUpdate(encoded, table, where, params)`:

```typescript
// In skills.repository.ts:
update(id: string, input: unknown) {
  const data = this.validate(UpdateSkillSchema, input);
  if (!this.getById(id)) return null;
  const encoded = UpdateSkillCodec.encode(data);
  this.buildDynamicUpdate(encoded, 'skills', 'id = @id', { id });
  return this.getById(id);
}
```

Codec encode handles: camelCase → snake_case, JSON.stringify arrays, boolean → int.
`buildDynamicUpdate` handles: filtering undefined, building SET clauses, adding `updated_at`.

For tables without `updated_at` (e.g. vault_secrets): pass `{ skipTimestamp: true }`.

## Type Safety

- **No `as any`** — Never use `as any` anywhere
- **No loose `as Record<string, unknown>`** — Use typed interfaces. Only acceptable in generic merge utilities where the cast is inherently required
- **DB row types** live in `src/types.ts` as `Db*Row` interfaces (snake_case columns)
- **Domain types** come from `@agenshield/ipc` (camelCase)
- Model mappers convert between DB rows and domain types

## Scoping

- Config: base → target → target+user (merge, NULL = inherit)
- Policies: UNION all matching scopes (additive, priority for conflicts)
- Secrets: most specific wins per name (target+user > target > base)

## Encryption

- Column-level AES-256-GCM for vault data only
- scrypt key derivation from passcode
- Vault operations throw `StorageLockedError` when locked
- Everything else (config, policies, state, skills) is plaintext

## Testing

- Tests live inside each domain folder: `__tests__/{name}.repository.spec.ts`
- Core tests (crypto, scoping, migrations) stay in `src/__tests__/`
- Tests use tmp SQLite databases (`createTestDb()` helper)
- Each test gets a fresh database (beforeEach)
- Tests must cover: CRUD, validation errors, scope resolution, encryption round-trips, **performance** (ops/sec benchmarks)
