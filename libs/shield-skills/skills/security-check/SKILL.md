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

agenshield:
  policy: builtin-security-check
  allowed-commands:
    - shieldctl status
    - shieldctl policies list
  required-approval: false
  audit-level: info
---

# Security Check

Check the current security status of the AgenShield installation.

## Usage

Run this skill to verify:
- Broker daemon is running and healthy
- Policies are properly configured
- Network isolation is active
- Socket permissions are correct

## Commands

```bash
# Check overall status
shieldctl status

# List active policies
shieldctl policies list

# Ping the broker
shieldctl ping
```

## Example Output

```
AgenShield Status
=================
Broker: Running (PID: 12345)
Socket: /var/run/agenshield.sock (OK)
HTTP Fallback: localhost:5200 (OK)
Active Policies: 8
Last Audit Entry: 2 minutes ago

Network Isolation: ACTIVE
File Restrictions: ACTIVE
Command Filtering: ACTIVE
```

## Troubleshooting

If the status check fails:

1. Check if the broker daemon is running:
   ```bash
   launchctl list | grep agenshield
   ```

2. Check broker logs:
   ```bash
   tail -50 /var/log/agenshield/broker.error.log
   ```

3. Verify socket permissions:
   ```bash
   ls -la /var/run/agenshield/
   ```
