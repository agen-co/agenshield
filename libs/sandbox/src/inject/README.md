# Inject

Skill injection and macOS app resolution. Injects security-related skills into the target application's skills directory and resolves the path to the embedded macOS app bundle.

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

### macOS App (`macos-app.ts`)

#### Functions

- **`getMacAppBundlePath()`** -- Resolve the path to the embedded `AgenShield.app` bundle that ships inside the `@agenshield/sandbox` npm package. Returns `null` if the bundle is not found (development mode or Xcode build was skipped).

## Internal Dependencies

- `@agenshield/ipc` -- `UserConfig` type
- `@agenshield/sandbox/package.json` -- Used to locate the `macos-app/` directory

## Testing

- `getSkillsDir()` and `getAgenCoSkillPath()` can be tested by mocking filesystem existence checks.
- `getMacAppBundlePath()` depends on the package directory structure and can be tested with fixture directories.

## Notes

- The AgenCo skill is auto-generated and deployed by the daemon at runtime. The injector copies it into the target application's skills directory so it is visible to the agent.
- The macOS app bundle is an optional component. It is only present when the Xcode build step has been run.
- Skill injection uses `sudo` for writing to directories owned by the broker user.
