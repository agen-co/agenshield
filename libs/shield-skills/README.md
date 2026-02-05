# @agenshield/skills

Skill loader, validator, registry, and executor for OpenClaw-compatible skills, plus "Soul" system prompt injection utilities.

## Purpose
- Parse `SKILL.md` files with YAML frontmatter.
- Validate skill manifests for basic correctness.
- Register and look up skills in memory.
- Execute skills with optional policy checks and audit logging.
- Inject security guidance into system prompts (Soul).

## Key Components
- `src/loader.ts` - Loads and parses `SKILL.md` files.
- `src/validator.ts` - Validates skill manifests and content.
- `src/registry.ts` - In-memory registry of loaded skills.
- `src/executor.ts` - Executes skill commands via `spawn`.
- `src/soul/*` - Soul prompt templates and injector.

## Usage
### Load and register skills
```ts
import { SkillLoader, SkillRegistry } from '@agenshield/skills';

const loader = new SkillLoader();
const registry = new SkillRegistry();

const skills = await loader.loadFromDirectories([
  '/opt/agenshield/skills',
  '/Users/clawagent/.agenshield/skills',
]);

registry.registerAll(skills);
```

### Validate a skill
```ts
import { validateSkill } from '@agenshield/skills';

const result = validateSkill(skill);
if (!result.valid) {
  console.error(result.errors);
}
```

### Execute a skill
```ts
import { SkillExecutor } from '@agenshield/skills';

const executor = new SkillExecutor({
  checkPolicy: async (operation, target) => true,
  auditLog: (entry) => console.log(entry),
});

const result = await executor.execute(skill, {
  args: ['echo hello'],
  timeout: 30000,
});
```

### Soul injection
```ts
import { SoulInjector } from '@agenshield/skills';

const injector = new SoulInjector({ mode: 'prepend', securityLevel: 'high' });
const prompt = injector.inject('Original system prompt', {
  workspacePath: '/Users/clawagent/workspace',
  allowedOperations: ['read', 'list'],
});
```

## SKILL.md Format
Skills use YAML frontmatter plus Markdown body:
```markdown
---
name: security-check
description: Check security status
user-invocable: true
command-dispatch: bash
command-arg-mode: single
requires:
  bins:
    - shieldctl
agenshield:
  policy: builtin-security-check
  allowed-commands:
    - shieldctl status
---

# Skill Title

Detailed instructions...
```

## Built-in Skills
This repo ships example skills under `libs/shield-skills/skills/`:
- `security-check`
- `secret-broker`
- `policy-enforce`
- `soul-shield`

The library does **not** auto-load these; consumers must load them explicitly via `SkillLoader`.

## Limitations and Caveats
- The YAML parser is intentionally simple; complex YAML features are not supported.
- `SkillExecutor` runs commands via `spawn` and does not sandbox execution on its own.
- `allowedCommands` is only enforced if the caller provides a `checkPolicy` function.
- There is no built-in persistence for skill registries.

## Roadmap (Ideas)
- Replace the YAML parser with a full YAML library.
- Add execution backends that route through the broker by default.
- Richer validation (schema versioning, OS/platform constraints).
- Streaming execution output and structured results.

## Development
```bash
# Build
npx nx build shield-skills
```

## Contribution Guide
- Keep the manifest contract backward compatible; prefer additive changes.
- Update `src/types.ts` and `src/validator.ts` together.
- Add new Soul templates in `src/soul/templates.ts` and expose via `getSoulContent()`.

## Agent Notes
- `SkillLoader.parseManifest()` expects frontmatter and uses indentation for nesting.
- Skills are normalized to the `Skill` interface; missing fields are defaulted.
- `SkillExecutor.buildCommand()` controls dispatch for `bash`, `node`, and `python`.
- Built-in skills live in `libs/shield-skills/skills/` for reference/testing.
