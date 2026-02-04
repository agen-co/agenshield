# @agenshield/skills

OpenClaw-compatible skills with Soul integration for AgenShield.

## Overview

This library provides skill management for AgenShield, compatible with OpenClaw's AgentSkills format. It includes:

- **Skill Loading** - Parse SKILL.md files
- **Skill Validation** - Validate skill manifests
- **Skill Execution** - Execute skills with policy enforcement
- **Soul Integration** - System prompt injection for security

## Installation

```bash
npm install @agenshield/skills
```

## Usage

### Loading Skills

```typescript
import { SkillLoader, SkillRegistry } from '@agenshield/skills';

const loader = new SkillLoader();
const registry = new SkillRegistry();

// Load skills from directories
const skills = await loader.loadFromDirectories([
  '/opt/agenshield/skills',
  '~/.agenshield/skills',
]);

// Register skills
for (const skill of skills) {
  registry.register(skill);
}

// Get a specific skill
const skill = registry.get('security-check');
```

### Validating Skills

```typescript
import { validateSkill } from '@agenshield/skills';

const result = validateSkill(skillManifest);
if (!result.valid) {
  console.error('Validation errors:', result.errors);
}
```

### Executing Skills

```typescript
import { SkillExecutor } from '@agenshield/skills';

const executor = new SkillExecutor({
  brokerClient,
  policyEnforcer,
});

const result = await executor.execute('security-check', {
  args: ['--verbose'],
  context: { userId: 'clawagent' },
});
```

### Soul Integration

```typescript
import { SoulInjector } from '@agenshield/skills';

const injector = new SoulInjector({
  mode: 'prepend',
  content: 'You are a security-conscious AI assistant...',
});

const enhancedPrompt = injector.inject(originalSystemPrompt, {
  securityLevel: 'high',
  allowedOperations: ['read', 'list'],
});
```

## SKILL.md Format

Skills are defined using YAML frontmatter in SKILL.md files:

```markdown
---
name: security-check
description: Check current security status and policy compliance
user-invocable: true
disable-model-invocation: false
command-dispatch: bash
command-tool: Bash
command-arg-mode: single

requires:
  bins:
    - shieldctl
  env:
    - AGENSHIELD_SOCKET

agenshield:
  policy: security-check-policy
  allowed-commands:
    - shieldctl status
    - shieldctl policies list
  required-approval: false
  audit-level: info
---

# Security Check

This skill checks the current security status of the AgenShield installation.

## Usage

Run this skill to verify:
- Broker daemon is running
- Policies are properly configured
- Network isolation is active

## Commands

- `shieldctl status` - Show overall status
- `shieldctl policies list` - List active policies
```

## Built-in Skills

### security-check

Check current security status and policy compliance.

```bash
/security-check
```

### secret-broker

Request secrets through the broker daemon.

```bash
/secret-broker get API_KEY
```

### policy-enforce

Check if a specific action would be allowed.

```bash
/policy-enforce http_request https://api.example.com
```

### soul-shield

Manage soul protection settings.

```bash
/soul-shield status
/soul-shield enable
```

## Soul Configuration

Soul injection modifies the system prompt to include security guidelines:

```typescript
interface SoulConfig {
  enabled: boolean;
  mode: 'prepend' | 'append' | 'replace';
  content?: string;
  securityLevel?: 'low' | 'medium' | 'high';
}
```

### Modes

- **prepend** - Add security content before original prompt
- **append** - Add security content after original prompt
- **replace** - Replace original prompt entirely

### Default Soul Content

```
You are operating within a secure AgenShield environment.

SECURITY GUIDELINES:
1. All network requests are routed through a security broker
2. File access is restricted to the workspace directory
3. Command execution requires policy approval
4. Secrets are managed through the vault - never expose them

RESTRICTIONS:
- Do not attempt to bypass network restrictions
- Do not access files outside the workspace
- Do not execute unauthorized commands
- Do not expose or log sensitive information

If an operation is blocked, explain the security reason to the user.
```

## API Reference

### SkillLoader

```typescript
class SkillLoader {
  loadFromFile(path: string): Promise<Skill>;
  loadFromDirectory(dir: string): Promise<Skill[]>;
  loadFromDirectories(dirs: string[]): Promise<Skill[]>;
}
```

### SkillRegistry

```typescript
class SkillRegistry {
  register(skill: Skill): void;
  unregister(name: string): void;
  get(name: string): Skill | undefined;
  list(): Skill[];
  listUserInvocable(): Skill[];
}
```

### SkillExecutor

```typescript
class SkillExecutor {
  execute(name: string, options: ExecuteOptions): Promise<ExecuteResult>;
  canExecute(name: string, context: Context): Promise<boolean>;
}
```

### SoulInjector

```typescript
class SoulInjector {
  inject(prompt: string, context: InjectionContext): string;
  getDefaultContent(): string;
  setContent(content: string): void;
}
```

## Types

```typescript
interface Skill {
  name: string;
  description: string;
  userInvocable: boolean;
  disableModelInvocation: boolean;
  commandDispatch: 'bash' | 'node' | 'python';
  commandTool: string;
  commandArgMode: 'single' | 'multi';
  requires: SkillRequirements;
  agenshield?: AgenShieldConfig;
  content: string;
}

interface SkillRequirements {
  bins?: string[];
  anyBins?: string[];
  env?: string[];
  config?: string[];
}

interface AgenShieldConfig {
  policy?: string;
  allowedCommands?: string[];
  requiredApproval?: boolean;
  auditLevel?: 'debug' | 'info' | 'warn' | 'error';
}
```

## License

MIT
