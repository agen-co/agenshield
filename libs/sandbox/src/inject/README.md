# Inject

Skill injection for the target application's skills directory.

## Public API

### Skill Injector (`skill-injector.ts`)

#### Functions

- **`injectAgenCoSkill(homeDir, options?)`** -- Inject the AgenCo security skill into the target application's skills directory. Copies the skill from its deployed location into the agent's `~/.openclaw/workspace/skills/agenco/` directory.
- **`createAgenCoSymlink(homeDir, options?)`** -- Create a symlink to the AgenCo skill instead of copying it.
- **`removeInjectedSkills(homeDir)`** -- Remove all AgenShield-injected skills from the skills directory.
- **`updateOpenClawMcpConfig(homeDir, options?)`** -- Update the OpenClaw MCP configuration to register injected skills.
- **`getSkillsDir(homeDir)`** -- Resolve the skills directory path. Checks `~/.openclaw/workspace/skills/` and `~/.config/openclaw/skills/`.
- **`getAgenCoSkillPath()`** -- Resolve the AgenCo skill source path. Checks daemon-deployed location first, then global fallback.

#### Types

- **`SkillInjectionResult`** -- `{ success, skillsDir, injectedSkills, error? }`

## Internal Dependencies

- `@agenshield/ipc` -- `UserConfig` type

## Testing

- `getSkillsDir()` and `getAgenCoSkillPath()` can be tested by mocking filesystem existence checks.

## Notes

- The AgenCo skill is auto-generated and deployed by the daemon at runtime. The injector copies it into the target application's skills directory so it is visible to the agent.
- Skill injection uses `sudo` for writing to directories owned by the broker user.
