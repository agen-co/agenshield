---
name: secret-broker
description: Request secrets through the broker daemon securely
user-invocable: true
disable-model-invocation: true
command-dispatch: bash
command-tool: Bash
command-arg-mode: single

requires:
  bins:
    - shieldctl

agenshield:
  policy: builtin-secret-broker
  allowed-commands:
    - shieldctl secret get
  required-approval: true
  audit-level: warn
  securityLevel: high
---

# Secret Broker

Securely request secrets from the AgenShield vault.

## Important Security Note

This skill requires explicit user approval before execution. Secrets are:
- Never logged in plain text
- Only accessible via Unix socket (not HTTP)
- Audited for every access

## Usage

```bash
# Get a secret value
shieldctl secret get API_KEY

# Get a secret and set as environment variable
export API_KEY=$(shieldctl secret get API_KEY)
```

## Available Secrets

Secrets must be pre-configured in the vault. Common secrets include:
- `API_KEY` - API authentication key
- `DATABASE_URL` - Database connection string
- `OAUTH_SECRET` - OAuth client secret

## Adding Secrets

Secrets can only be added by an administrator:

```bash
# As root or with sudo
agenshield-admin vault set API_KEY "your-secret-value"
```

## Security Considerations

1. **Never echo secrets** - Don't print secret values to stdout
2. **Use in subshell** - Prefer `$(shieldctl secret get X)` over variables
3. **Minimize exposure** - Request secrets only when needed
4. **Audit trail** - All secret access is logged
