# AgenShield

Open-source security daemon for AI agents.

## The Problem

Open-source AI skills can contain malicious code that:
- Steals API keys and credentials from your filesystem
- Executes unauthorized commands
- Exfiltrates sensitive data to external servers

## The Solution

AgenShield provides:
- **Sandboxed Execution** - Run agent commands under unprivileged users
- **Command Broker** - Policy-based command filtering and approval
- **Vault Integration** - Inject secrets safely without exposing plaintext keys
- **Allowlist Enforcement** - Only permitted actions can execute

## Quick Start

```bash
npx agenshield
```

This opens the setup wizard to configure AgenShield for your environment.

## Development

```bash
# Build
npx nx build cli

# Test
npx nx test cli

# Run CLI locally
npx nx run cli:dev
```

## License

MIT
