# OpenClaw Skills Integration Mapping for AgenShield

This document provides a comprehensive mapping between OpenClaw's skills system and AgenShield's policy/security architecture. It serves as the implementation guide for the AgenShield skills library.

---

## Table of Contents

1. [Overview](#overview)
2. [OpenClaw Skill Fields to AgenShield Policy Fields](#openclaw-skill-fields-to-agenshield-policy-fields)
3. [Soul Injection Points to Daemon/Hooks Config](#soul-injection-points-to-daemonhooks-config)
4. [SKILL.md Format Requirements](#skillmd-format-requirements)
5. [AgenShield Integration Architecture](#agenshield-integration-architecture)
6. [Implementation Roadmap](#implementation-roadmap)

---

## Overview

OpenClaw implements **AgentSkills-compatible skill folders** that teach AI agents how to use tools. Each skill is a directory containing a `SKILL.md` file with YAML frontmatter and instructions. AgenShield needs to intercept, validate, and potentially modify skill behavior to enforce security policies.

### Key Integration Points

| OpenClaw Component | AgenShield Component | Integration Type |
|-------------------|---------------------|------------------|
| `SKILL.md` files | Policy definitions | Validation & enforcement |
| `skills.entries` config | Security policies | Override & restriction |
| Soul hooks | Daemon hooks | Injection & monitoring |
| Environment injection | Vault/broker | Secret management |

---

## OpenClaw Skill Fields to AgenShield Policy Fields

### Core Skill Frontmatter Fields

| OpenClaw Field | Type | Default | AgenShield Mapping | Notes |
|---------------|------|---------|-------------------|-------|
| `name` | string | required | `PolicyConfig.name` | Skill identifier, must be unique |
| `description` | string | required | `PolicyConfig.patterns[]` | Used for pattern matching |
| `homepage` | URL | optional | `SkillMetadata.homepage` | For UI display only |
| `user-invocable` | boolean | `true` | `SkillPolicy.allowUserInvocation` | Whether exposed as slash command |
| `disable-model-invocation` | boolean | `false` | `SkillPolicy.allowModelInvocation` | Excludes from model prompt if true |
| `command-dispatch` | `"tool"` | - | `SkillPolicy.dispatchMode` | Bypasses model; direct dispatch |
| `command-tool` | string | - | `SkillPolicy.targetTool` | Specifies tool to invoke |
| `command-arg-mode` | `"raw"` | `"raw"` | `SkillPolicy.argMode` | How args are forwarded |

### Proposed AgenShield Skill Policy Schema

```typescript
interface SkillPolicy {
  /** Unique identifier for the skill policy */
  id: string;

  /** Skill name (matches OpenClaw skill name) */
  skillName: string;

  /** Human-readable description */
  description: string;

  /** Policy type - how to handle this skill */
  type: 'allow' | 'deny' | 'restrict' | 'audit';

  /** Whether this policy is active */
  enabled: boolean;

  /** User invocation control */
  allowUserInvocation: boolean;

  /** Model invocation control */
  allowModelInvocation: boolean;

  /** Dispatch mode override */
  dispatchMode?: 'tool' | 'model' | 'blocked';

  /** Target tool override */
  targetTool?: string;

  /** Argument handling mode */
  argMode?: 'raw' | 'parsed' | 'sanitized';

  /** Environment variables this skill can access */
  allowedEnvVars?: string[];

  /** Commands this skill can execute */
  allowedCommands?: string[];

  /** Files/paths this skill can access */
  allowedPaths?: string[];

  /** Required security level to use this skill */
  requiredSecurityLevel?: 'secure' | 'partial' | 'any';
}
```

### Skill Metadata Fields (metadata.openclaw)

| OpenClaw Metadata Field | Type | AgenShield Mapping | Purpose |
|------------------------|------|-------------------|---------|
| `requires.bins` | string[] | `SkillRequirements.requiredBinaries` | Binaries that must exist on PATH |
| `requires.anyBins` | string[] | `SkillRequirements.anyRequiredBinaries` | At least one must exist |
| `requires.env` | string[] | `SkillRequirements.requiredEnvVars` | Required environment variables |
| `requires.config` | string[] | `SkillRequirements.requiredConfig` | openclaw.json paths that must be truthy |
| `always` | boolean | `SkillPolicy.bypassGates` | Skip all requirement gates |
| `emoji` | string | `SkillMetadata.emoji` | UI icon (informational) |
| `os` | string[] | `SkillRequirements.platforms` | Platform restrictions (darwin, linux, win32) |
| `primaryEnv` | string | `SkillSecrets.primaryEnvVar` | Associated environment variable |
| `install` | object | `SkillInstaller` | Installer specs |
| `skillKey` | string | `SkillPolicy.configKey` | Custom config mapping key |

### Proposed AgenShield Skill Requirements Schema

```typescript
interface SkillRequirements {
  /** Binaries that must all exist on PATH */
  requiredBinaries?: string[];

  /** At least one binary must exist */
  anyRequiredBinaries?: string[];

  /** Required environment variables */
  requiredEnvVars?: string[];

  /** Required config paths in agenshield.json */
  requiredConfig?: string[];

  /** Platform restrictions */
  platforms?: ('darwin' | 'linux' | 'win32')[];
}

interface SkillSecrets {
  /** Primary environment variable for this skill */
  primaryEnvVar?: string;

  /** Whether to inject via AgenShield broker */
  useBroker: boolean;

  /** Secret names managed by AgenShield vault */
  vaultSecrets?: string[];
}
```

---

## Soul Injection Points to Daemon/Hooks Config

### OpenClaw Soul Hook Architecture

The SOUL Evil hook operates at the `agent:bootstrap` process, replacing SOUL content before system prompt assembly. Key characteristics:

- **Injection Point**: `agent:bootstrap` event
- **In-Memory Only**: Does not modify files on disk
- **Sub-Agent Exclusion**: Sub-agent runs exclude `SOUL.md` from bootstrap

### OpenClaw Soul Hook Configuration

```json
{
  "hooks": {
    "soul-evil": {
      "enabled": true,
      "file": "SOUL_EVIL.md",
      "chance": 0.1,
      "purge": {
        "at": "14:00",
        "duration": "30m"
      }
    }
  }
}
```

### AgenShield Hooks Configuration Mapping

| OpenClaw Hook Field | Type | AgenShield Mapping | Purpose |
|--------------------|------|-------------------|---------|
| `enabled` | boolean | `HookConfig.enabled` | Hook activation |
| `file` | string | `HookConfig.alternateFile` | Alternate SOUL filename |
| `chance` | number (0-1) | `HookConfig.activationProbability` | Random activation chance |
| `purge.at` | string (HH:MM) | `HookConfig.scheduleStart` | Daily window start |
| `purge.duration` | string | `HookConfig.scheduleDuration` | Window length |

### Proposed AgenShield Hooks Schema

```typescript
interface HooksConfig {
  /** Bootstrap hooks - fire during agent initialization */
  bootstrap?: BootstrapHook[];

  /** Tool hooks - fire before/after tool execution */
  tool?: ToolHook[];

  /** Prompt hooks - modify system prompts */
  prompt?: PromptHook[];

  /** Network hooks - intercept network requests */
  network?: NetworkHook[];
}

interface BootstrapHook {
  /** Hook identifier */
  id: string;

  /** Human-readable name */
  name: string;

  /** Whether hook is active */
  enabled: boolean;

  /** Hook type */
  type: 'soul-inject' | 'skill-filter' | 'env-inject' | 'custom';

  /** Activation conditions */
  activation: {
    /** Always active */
    always?: boolean;

    /** Random activation probability (0-1) */
    probability?: number;

    /** Scheduled activation window */
    schedule?: {
      /** Start time (24h format HH:MM) */
      startTime: string;
      /** Duration (e.g., "30m", "2h") */
      duration: string;
      /** Timezone (uses system default if not set) */
      timezone?: string;
    };
  };

  /** Hook-specific configuration */
  config: Record<string, unknown>;
}

interface SoulInjectHookConfig {
  /** Alternate SOUL file to inject */
  alternateFile: string;

  /** Whether to completely replace or merge */
  mode: 'replace' | 'append' | 'prepend';

  /** Audit logging */
  logActivation: boolean;
}

interface ToolHook {
  /** Hook identifier */
  id: string;

  /** Tool name pattern to match */
  toolPattern: string;

  /** When to fire */
  timing: 'before' | 'after' | 'both';

  /** Action to take */
  action: 'allow' | 'deny' | 'audit' | 'transform';

  /** Transform function (if action is 'transform') */
  transformer?: string;
}

interface PromptHook {
  /** Hook identifier */
  id: string;

  /** Prompt section to modify */
  target: 'system' | 'user' | 'skills' | 'all';

  /** Modification type */
  action: 'inject' | 'filter' | 'transform';

  /** Content to inject or regex to filter */
  content: string;

  /** Position for injection */
  position?: 'start' | 'end' | 'after-skills';
}
```

### Hook Lifecycle Integration

```
OpenClaw Bootstrap Flow          AgenShield Integration Points
------------------------         -----------------------------
1. Session starts           -->  [hook:session-start] - Audit, initialize
2. Skills loaded            -->  [hook:skills-loaded] - Filter, restrict
3. SOUL.md read             -->  [hook:soul-read] - Inject, modify
4. System prompt assembled  -->  [hook:prompt-assembled] - Final audit
5. Agent run begins         -->  [hook:run-start] - Monitor
6. Tools executed           -->  [hook:tool-execute] - Intercept, validate
7. Session ends             -->  [hook:session-end] - Cleanup, log
```

---

## SKILL.md Format Requirements

### File Structure

Skills must be organized in directories with a `SKILL.md` file:

```
<skill-name>/
  SKILL.md         # Required - skill definition
  README.md        # Optional - documentation
  templates/       # Optional - prompt templates
  scripts/         # Optional - helper scripts
```

### SKILL.md Format

```markdown
---
name: skill-name
description: What the skill does (single line)
homepage: https://example.com (optional)
user-invocable: true (optional, default true)
disable-model-invocation: false (optional, default false)
command-dispatch: tool (optional)
command-tool: toolname (optional)
command-arg-mode: raw (optional, default raw)
---

## Instructions for the agent

Markdown content describing how to use this skill.

Use `{baseDir}` to reference the skill folder path.
```

### Frontmatter Rules

1. **Single-line values only** - Parser does not support multiline YAML
2. **Metadata must be single-line JSON** - Complex metadata in one line
3. **`{baseDir}` placeholder** - Resolves to skill folder path at runtime

### AgenShield SKILL.md Extensions

AgenShield will recognize additional frontmatter fields:

```yaml
---
name: protected-skill
description: A skill with security policies
agenshield:
  policy: strict
  allowed-commands:
    - read
    - list
  denied-commands:
    - write
    - delete
  required-approval: true
  audit-level: full
---
```

### Proposed Extended Frontmatter Schema

| Field | Type | Purpose |
|-------|------|---------|
| `agenshield.policy` | string | Policy preset (strict, moderate, permissive) |
| `agenshield.allowed-commands` | string[] | Allowlist of commands |
| `agenshield.denied-commands` | string[] | Denylist of commands |
| `agenshield.required-approval` | boolean | Require human approval |
| `agenshield.audit-level` | string | Logging verbosity (none, basic, full) |
| `agenshield.max-invocations` | number | Rate limiting |
| `agenshield.timeout` | string | Execution timeout |

---

## AgenShield Integration Architecture

### Skills Loading Integration

```
OpenClaw Skills Loading                AgenShield Processing
-----------------------                ---------------------
1. Workspace skills                    [Filter by workspace policies]
   <workspace>/skills

2. Managed/local skills                [Apply global policies]
   ~/.openclaw/skills

3. Bundled skills                      [Enforce bundled restrictions]
   (shipped with install)

4. Extra dirs (skills.load.extraDirs)  [Validate extra sources]
   (lowest precedence)

                    ↓
              Merged skill list
                    ↓
         AgenShield Policy Evaluation
                    ↓
              Filtered skill list
                    ↓
         Available skills for session
```

### Configuration File Mapping

```
OpenClaw Config (~/.openclaw/openclaw.json)
--------------------------------------------
{
  "skills": {
    "entries": {
      "skill-name": {
        "enabled": true,
        "apiKey": "...",
        "env": { ... },
        "config": { ... }
      }
    },
    "load": {
      "extraDirs": [...],
      "watch": true,
      "watchDebounceMs": 250
    },
    "install": {
      "preferBrew": true,
      "nodeManager": "npm"
    },
    "allowBundled": [...]
  }
}

AgenShield Config (~/.agenshield/config.json)
---------------------------------------------
{
  "version": "0.1.0",
  "daemon": {
    "port": 5200,
    "host": "localhost",
    "logLevel": "info"
  },
  "policies": [...],
  "vault": {
    "enabled": true,
    "provider": "local"
  },
  "skills": {
    "policies": [...],              // SkillPolicy[]
    "requirements": {...},          // Global requirements
    "hooks": {...}                  // HooksConfig
  }
}
```

### Environment Injection Flow

```
OpenClaw Environment Injection        AgenShield Broker Integration
------------------------------        -----------------------------
1. Skill metadata read           -->  [Intercept metadata]
2. skills.entries.<key>.env      -->  [Redirect to vault]
3. skills.entries.<key>.apiKey   -->  [Broker handles secrets]
4. Inject into process.env       -->  [Scoped injection via broker]
5. System prompt built           -->  [Secrets never in prompts]
6. Original env restored         -->  [Audit secret access]
```

### Security Integration Points

| OpenClaw Component | AgenShield Security Layer | Implementation |
|-------------------|--------------------------|----------------|
| Skill loading | Skill policy filter | Filter skills by policy before loading |
| Environment injection | Vault broker | Intercept and manage via secure broker |
| Tool execution | Sandbox enforcement | Route through guarded shell |
| Network requests | Allowlist/denylist | HTTP proxy with pattern matching |
| File access | Path restrictions | Sandbox user permissions |

---

## Implementation Roadmap

### Phase 1: Skills Policy Engine

**New files to create:**

1. `libs/shield-skills/src/types/skill-policy.ts`
   - SkillPolicy interface
   - SkillRequirements interface
   - SkillSecrets interface

2. `libs/shield-skills/src/parser/skill-parser.ts`
   - Parse SKILL.md files
   - Extract frontmatter
   - Validate against schema

3. `libs/shield-skills/src/policy/skill-policy-engine.ts`
   - Evaluate skill against policies
   - Return allow/deny/restrict decisions
   - Audit logging

### Phase 2: Hooks System

**New files to create:**

1. `libs/shield-daemon/src/hooks/types.ts`
   - HooksConfig interface
   - BootstrapHook interface
   - ToolHook interface
   - PromptHook interface

2. `libs/shield-daemon/src/hooks/registry.ts`
   - Register hooks
   - Priority ordering
   - Enable/disable management

3. `libs/shield-daemon/src/hooks/executor.ts`
   - Execute hook chains
   - Error handling
   - Timing/performance

4. `libs/shield-daemon/src/hooks/builtin/`
   - `soul-inject.ts` - SOUL injection hook
   - `skill-filter.ts` - Skill filtering hook
   - `env-audit.ts` - Environment audit hook

### Phase 3: OpenClaw Integration

**New files to create:**

1. `libs/shield-openclaw/src/interceptor.ts`
   - Intercept OpenClaw config loading
   - Inject AgenShield policies
   - Monitor skill activation

2. `libs/shield-openclaw/src/config-merger.ts`
   - Merge OpenClaw and AgenShield configs
   - Handle conflicts
   - Priority resolution

3. `libs/shield-openclaw/src/session-monitor.ts`
   - Monitor active sessions
   - Track skill usage
   - Report to daemon

### Phase 4: UI Integration

**Updates to existing:**

1. `apps/shield-ui/src/components/skills/`
   - Skill policy editor
   - Hook configuration UI
   - Audit log viewer

### Dependency Graph

```
shield-skills (new)
    ↓
shield-daemon (existing)
    ↓
shield-openclaw (new)
    ↓
shield-sandbox (existing)
    ↓
cli (existing)
```

### Configuration Schema Updates

Add to `libs/shield-ipc/src/types/config.ts`:

```typescript
export interface ShieldConfig {
  version: string;
  daemon: DaemonConfig;
  policies: PolicyConfig[];
  vault?: VaultConfig;

  // NEW: Skills configuration
  skills?: SkillsConfig;
}

export interface SkillsConfig {
  /** Skill-specific policies */
  policies: SkillPolicy[];

  /** Global skill requirements */
  requirements?: SkillRequirements;

  /** Hooks configuration */
  hooks?: HooksConfig;

  /** Skills loading configuration */
  loading?: {
    /** Additional skill directories */
    extraDirs?: string[];
    /** Watch for changes */
    watch?: boolean;
    /** Debounce interval in ms */
    watchDebounceMs?: number;
  };
}
```

---

## Quick Reference

### OpenClaw to AgenShield Field Mapping Summary

| OpenClaw | AgenShield |
|----------|------------|
| `skills.entries.<name>.enabled` | `skillPolicies[name].enabled` |
| `skills.entries.<name>.env` | `vault.secrets[name]` |
| `skills.entries.<name>.apiKey` | `vault.secrets[name].primary` |
| `skills.load.extraDirs` | `skills.loading.extraDirs` |
| `skills.allowBundled` | `skills.policies[].type='allow'` |
| `hooks.soul-evil` | `skills.hooks.bootstrap[]` |
| `metadata.openclaw.requires.*` | `skillPolicies[].requirements` |
| `metadata.openclaw.os` | `skillPolicies[].requirements.platforms` |

### Hook Event Mapping

| OpenClaw Event | AgenShield Hook |
|---------------|-----------------|
| `agent:bootstrap` | `hook:bootstrap` |
| Skill loaded | `hook:skill-loaded` |
| SOUL.md read | `hook:soul-read` |
| Tool execute | `hook:tool-execute` |
| Env inject | `hook:env-inject` |

---

## References

- OpenClaw Skills Documentation: https://docs.openclaw.ai/tools/skills
- OpenClaw Skills Config: https://docs.openclaw.ai/tools/skills-config
- OpenClaw Soul Hook: https://docs.openclaw.ai/hooks/soul-evil
- AgenShield Policy Schema: `/libs/shield-ipc/src/schemas/config.schema.ts`
- AgenShield Security Module: `/libs/shield-sandbox/src/security.ts`

---

*Document version: 1.0.0*
*Last updated: 2026-02-04*
*Author: AgenShield Development Team*
