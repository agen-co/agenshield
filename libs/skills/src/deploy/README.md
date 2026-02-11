# Deploy Service

Pluggable deploy adapters for writing skill files to disk and managing wrapper scripts.

## Architecture

```
deploy/
  types.ts                  # DeployAdapter interface, DeployContext, DeployResult, IntegrityCheckResult
  deploy.service.ts         # Orchestrates adapters, emits events
  adapters/
    openclaw.adapter.ts     # OpenClaw filesystem deployer
    index.ts
  index.ts
```

## Usage

```typescript
import { DeployService, OpenClawDeployAdapter } from '@agentshield/skills';

const adapter = new OpenClawDeployAdapter({
  skillsDir: '~/.openclaw/workspace/skills',
  binDir: '~/bin',
  createWrappers: true,
});

const deployer = new DeployService(skillsRepo, [adapter], emitter);
```

## Public API

### `DeployService`

| Method | Signature | Description |
|--------|-----------|-------------|
| `findAdapter` | `(targetId: string \| undefined) => DeployAdapter \| null` | Find first adapter that can deploy to the given target |
| `deploy` | `(installation, version, skill) => Promise<DeployResult \| null>` | Deploy via matching adapter; returns null if no adapter matches |
| `undeploy` | `(installation, version, skill) => Promise<void>` | Remove deployed files via matching adapter |
| `checkAllIntegrity` | `() => Promise<Array<{ installationId, adapterId, result }>>` | Verify file integrity for all active installations |

### `DeployAdapter` Interface

```typescript
interface DeployAdapter {
  readonly id: string;
  readonly displayName: string;
  canDeploy(targetId: string | undefined): boolean;
  deploy(context: DeployContext): Promise<DeployResult>;
  undeploy(installation: SkillInstallation, version: SkillVersion, skill: Skill): Promise<void>;
  checkIntegrity(installation: SkillInstallation, version: SkillVersion, files: SkillFile[]): Promise<IntegrityCheckResult>;
}
```

`canDeploy()` routes installations to the right adapter based on `targetId`.

### Types

```typescript
interface DeployContext {
  skill: Skill;
  version: SkillVersion;
  files: SkillFile[];
  installation: SkillInstallation;
}

interface DeployResult {
  wrapperPath?: string;
  deployedPath: string;
  deployedHash: string;
}

interface IntegrityCheckResult {
  intact: boolean;
  modifiedFiles: string[];
  missingFiles: string[];
  unexpectedFiles: string[];
  currentHash?: string;
  expectedHash?: string;
}
```
