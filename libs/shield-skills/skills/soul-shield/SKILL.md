---
name: soul-shield
description: Manage soul protection and system prompt injection settings
user-invocable: true
disable-model-invocation: true
command-dispatch: bash
command-tool: Bash
command-arg-mode: single

requires:
  bins:
    - shieldctl

agenshield:
  policy: builtin-soul-shield
  allowed-commands:
    - shieldctl soul status
    - shieldctl soul show
  required-approval: false
  audit-level: info
  securityLevel: high
---

# Soul Shield

Manage the soul protection system that injects security guidelines into AI system prompts.

## What is Soul Protection?

Soul protection ensures that AI agents operating within AgenShield receive consistent security guidelines as part of their system prompt. This helps maintain security awareness even for third-party AI models.

## Usage

```bash
# Check soul protection status
shieldctl soul status

# View current soul content
shieldctl soul show

# View soul content for specific security level
shieldctl soul show --level high
```

## Security Levels

### Low

Basic monitoring with minimal restrictions:
- Network requests are logged
- File access recommendations
- Permissive operation

### Medium (Default)

Balanced security with clear guidelines:
- All network through broker
- Workspace file restrictions
- Command approval awareness
- Secret management rules

### High

Maximum security with strict enforcement:
- Critical security requirements
- Absolute restrictions
- Compliance monitoring
- Session termination on violations

## Soul Content

The soul content is injected at agent startup. Default medium-security content:

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

## Configuration

Soul settings are configured in `/opt/agenshield/config/shield.json`:

```json
{
  "soul": {
    "enabled": true,
    "mode": "prepend",
    "securityLevel": "medium"
  }
}
```

### Modes

- **prepend** - Add soul content before original system prompt
- **append** - Add soul content after original system prompt
- **replace** - Replace system prompt entirely with soul content

## Verification

To verify soul protection is active:

```bash
# Check status
shieldctl soul status

# Expected output:
# Soul Protection: ENABLED
# Mode: prepend
# Security Level: medium
# Content Length: 523 characters
```
