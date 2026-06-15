# Usage

Once AgenShield is [installed](./installation.md), it runs as a background daemon
that enforces your organization's policy on the AI coding agents on your machine.

## Daemon lifecycle

```bash
agenshield start     # start the daemon
agenshield status    # health, enrollment, and enforcement status
agenshield stop      # stop the daemon
```

## Sign in

```bash
agenshield login
```

This opens your browser to link the device to your AgenShield workspace. Once
signed in, the daemon syncs your organization's policy from the cloud.

## What AgenShield enforces

With a policy in place, AgenShield governs what AI agents — Claude Code,
OpenClaw, and others — may do on your machine:

- **Process execution** — which programs an agent may run
- **File access** — reads/writes to sensitive paths (`.env`, SSH keys, credentials) are blocked
- **Network** — outbound connections are restricted to an allowlist
- **Skills & MCP** — unapproved agent skills are quarantined; MCP servers are governed
- **Managed settings** — organization settings are applied to supported agents

Policy is managed centrally by your administrator; the local daemon pulls it and
enforces it on the device.

## Status & health

```bash
agenshield status     # high-level status
agenshield doctor     # diagnose installation, extension, or daemon issues
```

The menu-bar app shows live status at a glance and can open the dashboard.

## Logs

```bash
agenshield logs       # recent daemon activity
```

## Keeping up to date

```bash
agenshield upgrade
```

See the **[CLI reference](./cli.md)** for the complete command list.
