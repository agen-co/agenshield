# presets/

Predefined policy sets that provide sensible defaults for common use cases.

## Available Presets

| ID | Name | Policies | Description |
|----|------|----------|-------------|
| `openclaw` | OpenClaw | 5 | AI Provider APIs, Package Registries, Core Commands, Workspace Access, Messaging Channels |
| `claudecode` | Claude Code | 4 | AI Provider APIs, Package Registries, Claude Code Commands, Workspace Access |
| `agenco` | AgenCo Integrations | 2 | AgenCo Commands, AgenCo Marketplace URLs |

## Exports

| Export | Type | Description |
|--------|------|-------------|
| `OPENCLAW_PRESET` | `PolicyPreset` | OpenClaw AI coding agent preset |
| `CLAUDECODE_PRESET` | `PolicyPreset` | Anthropic Claude Code agent preset |
| `AGENCO_PRESET` | `PolicyPreset` | AgenCo secure integration preset |
| `POLICY_PRESETS` | `PolicyPreset[]` | Array of all presets |
| `PRESET_MAP` | `Record<string, PolicyPreset>` | Map from preset ID to definition |
| `getPresetById(id)` | `PolicyPreset \| undefined` | Lookup preset by ID |

## PolicyPreset Interface

```typescript
interface PolicyPreset {
  id: string;
  name: string;
  description: string;
  policies: PolicyConfig[];
}
```

## Usage

Presets are seeded via `PolicyManager.seedPreset(presetId)` which calls `storage.policies.seedPreset()` and triggers a recompile.
