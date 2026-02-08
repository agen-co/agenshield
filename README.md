# AgenShield

**Open-source security sandbox for AI agents on macOS.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![macOS](https://img.shields.io/badge/platform-macOS_12+-lightgrey.svg)]()
[![Node.js 24](https://img.shields.io/badge/node-24.x-green.svg)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)]()

> [!WARNING]
> AgenShield is under **heavy development**. Expect breaking changes between releases. APIs, configuration formats, and CLI flags may change without notice.

## The Problem

Open-source AI skills (MCP servers, tool plugins, agents) execute code on your machine with full access to:

- **Your filesystem** - API keys in `~/.env`, SSH keys, cloud credentials, browser cookies
- **Your network** - exfiltrate data to any server, download malware, pivot laterally
- **System commands** - `rm -rf`, install backdoors, modify startup items, escalate privileges
- **Other processes** - read memory of running applications, inject into other tools

A single malicious or compromised skill can own your entire machine.

## The Solution - Six Security Layers

AgenShield wraps AI agents in a defense-in-depth sandbox with six isolation layers:

| Layer | Mechanism | What It Does |
|-------|-----------|-------------|
| **1. User Isolation** | Unprivileged macOS users via `dscl` | Agent runs as `ash_default_agent` (uid 5200) with no admin access |
| **2. Group Access Control** | Socket and workspace groups | Only group members can access the broker socket or workspace files |
| **3. Guarded Shell** | Restricted `zsh` with locked-down `PATH` | Agent can only run approved binaries from its own `~/bin` |
| **4. macOS Seatbelt** | `sandbox-exec` with deny-default profiles | Blocks all filesystem, network, and process access except explicit allowlists |
| **5. Command Wrappers** | `curl`, `python`, `node`, `git` routed through broker | Every external command is policy-checked before execution |
| **6. Node.js Interceptor** | Hooks `child_process`, `fetch`, `http` at runtime | Catches programmatic network/exec calls that bypass wrappers |

---

# User Guide

## System Requirements

| Requirement | Details |
|-------------|---------|
| **OS** | macOS 12+ (Monterey or later) |
| **Node.js** | 24.x (via `nvm` recommended) |
| **Admin Access** | `sudo` required during setup |
| **Xcode CLT** | Required (`xcode-select --install`) |

## Quick Start

```bash
# Install and configure (opens web-based wizard on http://127.0.0.1:5200)
npx agenshield@latest setup

# Or use terminal-only mode
npx agenshield@latest setup --cli

# Check installation status
npx agenshield status

# Diagnose issues
npx agenshield doctor
```

The setup wizard will:
1. Create isolated macOS users and groups (`ash_default_agent`, `ash_default_broker`)
2. Create system directories (`/opt/agenshield/`, `/etc/agenshield/`, etc.)
3. Generate macOS Seatbelt sandbox profiles
4. Install command wrappers (curl, python, node, git, etc.)
5. Install and start LaunchDaemons (broker, OpenClaw daemon, OpenClaw gateway)
6. Optionally install Homebrew and Node.js inside the sandbox
7. Migrate your target application into the sandbox
8. Verify the full installation

## CLI Reference

### `agenshield setup`

Run the setup wizard to sandbox a target application.

| Flag | Description |
|------|-------------|
| `--cli` | Use terminal UI instead of web browser |
| `--target <preset>` | Target preset: `openclaw`, `custom` (default: auto-detect) |
| `--entry-point <path>` | Entry point for custom target (Node.js file) |
| `--base-name <name>` | Base name for users/groups (default: `default`) |
| `--prefix <prefix>` | Custom prefix for users/groups (for testing multiple instances) |
| `--base-uid <uid>` | Base UID for created users (default: `5200`) |
| `--dry-run` | Show what would be done without making changes |
| `--skip-confirm` | Skip confirmation prompts |
| `-v, --verbose` | Show verbose output |
| `--list-presets` | List available presets and exit |

### `agenshield status`

Show current AgenShield installation status.

| Flag | Description |
|------|-------------|
| `-j, --json` | Output as JSON |

### `agenshield doctor`

Check and diagnose common issues.

| Flag | Description |
|------|-------------|
| `-j, --json` | Output as JSON |
| `--fix` | Attempt to fix issues automatically |

### `agenshield daemon <subcommand>`

Manage the AgenShield daemon.

| Subcommand | Description | Flags |
|------------|-------------|-------|
| `start` | Start the daemon | `-f, --foreground` |
| `stop` | Stop the daemon | |
| `restart` | Restart the daemon | |
| `status` | Show daemon status | `-j, --json` |

### `agenshield uninstall`

Reverse isolation and restore the original application.

| Flag | Description |
|------|-------------|
| `-f, --force` | Skip confirmation prompt |
| `--prefix <prefix>` | Uninstall a specific prefixed installation |
| `--skip-backup` | Force uninstall without backup (will not restore application) |

### `agenshield dev`

Run AgenShield in dev mode with interactive TUI for testing sandbox actions.

| Subcommand / Flag | Description |
|--------------------|-------------|
| *(no subcommand)* | Start dev mode |
| `clean` | Stop daemon, remove dev users/groups, clean up dev state |
| `shell` | Open interactive login shell as the sandboxed agent user |
| `--base-name <name>` | Base name for users/groups |
| `--prefix <prefix>` | Custom prefix (default: `dev`) |
| `--base-uid <uid>` | Base UID for users |
| `--no-tui` | Start daemon without interactive TUI |
| `shell --no-daemon` | Open shell without starting/stopping daemon |

## Dashboard

After setup, the AgenShield dashboard is available at **http://127.0.0.1:5200**.

**Pages:**

| Page | Description |
|------|-------------|
| **Overview** | Traffic chart, activity feed, security status, daemon info |
| **Policies** | Manage command, network, and filesystem policies |
| **Skills** | View and manage installed/quarantined AI skills |
| **Secrets** | Manage secrets injected into the sandbox by scope |
| **Settings** | Daemon configuration, OpenClaw config, passcode |

Passcode protection is optional and can be set during setup or later in Settings. When enabled, the dashboard requires authentication to make changes.

## Policy System

AgenShield uses a **deny-default** policy model. All operations are blocked unless explicitly allowed.

Policies are organized into categories:

- **Command policies** - which system commands the agent can execute
- **Network policies** - which hosts/ports the agent can reach
- **Filesystem policies** - which paths the agent can read/write

Example policy rule:

```json
{
  "id": "allow-github-api",
  "name": "Allow GitHub API",
  "type": "allowlist",
  "operations": ["http_request"],
  "patterns": ["https://api.github.com/**"],
  "enabled": true,
  "priority": 100
}
```

Policies are stored in `/opt/agenshield/policies/` and can be managed through the dashboard or API.

<details>
<summary><strong>Directory Structure</strong></summary>

### System Directories

```
/opt/agenshield/
├── bin/                         # Broker binary, node-bin, openclaw-launcher.sh
├── config/
│   └── shield.json              # Daemon configuration
├── policies/
│   ├── default.json             # Default policies
│   └── custom/                  # Custom policy files
├── lib/
│   └── interceptor/
│       └── register.cjs         # Node.js interceptor loader
├── ops/                         # Operational files
└── quarantine/
    └── skills/                  # Quarantined skill packages

/etc/agenshield/
├── seatbelt/
│   ├── agent.sb                 # Agent sandbox profile
│   └── ops/                     # Per-operation seatbelt profiles
└── zdot/                        # Guarded shell configuration

/var/run/agenshield/
└── agenshield.sock              # Unix socket (mode 0770)

/var/log/agenshield/
├── broker.log                   # Broker stdout
├── broker.error.log             # Broker stderr
├── openclaw-daemon.log          # OpenClaw daemon stdout
├── openclaw-gateway.log         # OpenClaw gateway stdout
└── daemon.log                   # Daemon log
```

### Agent Home (`/Users/ash_default_agent/`)

```
/Users/ash_default_agent/
├── bin/                         # Command wrappers (curl, python, node, git, etc.)
├── .openclaw/                   # OpenClaw configuration
│   ├── mcp.json                 # MCP server config
│   └── skills/                  # Installed skills
├── workspace/                   # Agent working directory
└── .nvm/                        # Node Version Manager (agent-local)
```

### User Configuration

```
~/.agenshield/                   # Per-user config (on host)
```

</details>

<details>
<summary><strong>Environment Variables</strong></summary>

### Runtime Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `AGENSHIELD_PORT` | Daemon HTTP port | `5200` |
| `AGENSHIELD_HOST` | Daemon HTTP host | `127.0.0.1` |
| `AGENSHIELD_SOCKET` | Unix socket path | `/var/run/agenshield/agenshield.sock` |
| `AGENSHIELD_CONFIG` | Path to config file | `/opt/agenshield/config/shield.json` |
| `AGENSHIELD_AGENT_HOME` | Agent home directory | `/Users/ash_default_agent` |
| `AGENSHIELD_LOG_LEVEL` | Log level (`warn`, `debug`, `info`, `error`) | `warn` |
| `AGENSHIELD_LOG_DIR` | Log directory | from config |
| `AGENSHIELD_FAIL_OPEN` | Fail open on broker errors | `false` |
| `AGENSHIELD_TIMEOUT` | Policy check timeout (ms) | `5000` |

### Interceptor Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `AGENSHIELD_INTERCEPT_FETCH` | Intercept `fetch()` calls | `true` |
| `AGENSHIELD_INTERCEPT_HTTP` | Intercept `http`/`https` module | `true` |
| `AGENSHIELD_INTERCEPT_WS` | Intercept WebSocket | `true` |
| `AGENSHIELD_INTERCEPT_EXEC` | Intercept `child_process` | `true` |
| `AGENSHIELD_CONTEXT_TYPE` | Execution context: `agent` or `skill` | `agent` |
| `AGENSHIELD_SKILL_SLUG` | Skill identifier (when context is `skill`) | |
| `AGENSHIELD_SEATBELT` | Enable seatbelt profiles | `true` |

</details>

## Troubleshooting

**Permission denied errors**
```bash
# Setup requires sudo
sudo npx agenshield@latest setup

# Check file ownership
ls -la /var/run/agenshield/
ls -la /opt/agenshield/
```

**Daemon won't start**
```bash
# Check if port 5200 is in use
lsof -i :5200

# Run in foreground to see errors
agenshield daemon start --foreground

# Check logs
cat /var/log/agenshield/broker.error.log
```

**Socket connection refused**
```bash
# Check socket exists
ls -la /var/run/agenshield/agenshield.sock

# Check broker is running
sudo launchctl list | grep agenshield

# Restart broker
sudo launchctl kickstart -k system/com.agenshield.broker
```

**Agent still has network access**
```bash
# Verify seatbelt profile is loaded
sudo -u ash_default_agent sandbox-exec -f /etc/agenshield/seatbelt/agent.sb -- curl https://example.com
# Should fail with "Operation not permitted"

# Check wrapper PATH
sudo -u ash_default_agent /usr/local/bin/guarded-shell -c 'echo $PATH'
```

**Run the doctor**
```bash
agenshield doctor --fix
```

## Uninstalling

```bash
sudo agenshield uninstall
```

This removes:
- Created users (`ash_default_agent`, `ash_default_broker`) and groups (`ash_default`, `ash_default_workspace`)
- System directories (`/opt/agenshield/`, `/etc/agenshield/`, `/var/run/agenshield/`, `/var/log/agenshield/`)
- LaunchDaemons (`com.agenshield.broker`, `com.agenshield.openclaw.daemon`, `com.agenshield.openclaw.gateway`)
- Command wrappers and seatbelt profiles

Your original application is restored from backup (unless `--skip-backup` was used during setup).

---

# Contributing / Development

## Development Setup

```bash
git clone https://github.com/AgenShield/agenshield.git
cd agenshield
nvm use          # v24
yarn install
yarn build
```

## Monorepo Structure

| Package | Directory | Purpose |
|---------|-----------|---------|
| `agenshield` | `libs/cli/` | CLI - setup wizard, status, doctor, daemon management |
| `@agenshield/daemon` | `libs/shield-daemon/` | HTTP daemon server (port 5200) with embedded UI |
| `@agenshield/broker` | `libs/shield-broker/` | Request broker - Unix socket (port 5201 HTTP fallback) |
| `@agenshield/sandbox` | `libs/shield-sandbox/` | User isolation, seatbelt, wrappers, directories |
| `@agenshield/interceptor` | `libs/shield-interceptor/` | Node.js runtime interception (ESM loader + CJS preload) |
| `@agenshield/patcher` | `libs/shield-patcher/` | Python network isolation via `sitecustomize.py` |
| `@agenshield/ipc` | `libs/shield-ipc/` | Shared types, schemas, constants |
| `@agenshield/integrations` | `libs/shield-integrations/` | OpenClaw and third-party integration utilities |
| `@agenshield/skills` | `libs/shield-skills/` | Skill analysis and management |
| `@agenshield/ui` | `apps/shield-ui/` | React 19 + Vite + MUI dashboard (port 4200 dev) |

<details>
<summary><strong>Full directory tree</strong></summary>

```
agenshield/
├── apps/
│   └── shield-ui/              # React dashboard
├── libs/
│   ├── cli/                    # CLI tool
│   ├── shield-broker/          # Request broker
│   ├── shield-daemon/          # HTTP daemon
│   ├── shield-interceptor/     # Node.js interceptor
│   ├── shield-integrations/    # Integration utilities
│   ├── shield-ipc/             # Shared types
│   ├── shield-patcher/         # Python patcher
│   ├── shield-sandbox/         # Sandbox utilities
│   └── shield-skills/          # Skill management
├── tools/
│   └── test-harness/           # Dummy OpenClaw for testing
└── scripts/
    └── registry/               # Local npm registry scripts
```

</details>

## Running Locally

```bash
# Start daemon in dev mode (watches for changes, uses ./tmp/dev-agent as agent home)
yarn daemon:dev

# Start UI dev server (port 4200, proxies API to daemon on 5200)
npx nx serve shield-ui

# Run CLI from source
yarn cli -- status
yarn cli -- doctor
sudo yarn cli:setup
```

## Build Commands

```bash
# Build all packages
yarn build

# Build a single package
npx nx build <package-name>

# Build UI only
npx nx build shield-ui

# Build CLI only
npx nx build cli
```

## Testing

```bash
# Unit tests (all packages)
yarn test

# Unit tests (single package)
npx nx test <package-name>

# E2E tests (requires sudo)
yarn test:e2e

# E2E policy tests
yarn test:e2e-policies

# E2E enforcement tests (requires sudo)
yarn test:e2e-enforcement

# Seatbelt integration tests
yarn test:seatbelt

# Install test harness (dummy OpenClaw)
yarn test-harness:install
```

## Code Quality

```bash
# Lint all packages
yarn lint

# Format all files
yarn format

# Check formatting
yarn format:check
```

Prettier config: 120 char width, single quotes, trailing commas.

<details>
<summary><strong>Daemon API Reference</strong></summary>

### Ports

| Service | Port | Protocol |
|---------|------|----------|
| Daemon | 5200 | HTTP |
| Broker HTTP fallback | 5201 | HTTP |
| Broker primary | `/var/run/agenshield/agenshield.sock` | Unix Socket |

### Route Groups

| Prefix | Description | Key Endpoints |
|--------|-------------|---------------|
| `/api/health` | Health check | `GET /api/health` |
| `/api/status` | Daemon status | `GET /api/status` |
| `/api/config` | Configuration | `GET`, `PUT /api/config`, `POST /api/config/factory-reset`, `POST /api/config/install-wrappers` |
| `/api/auth` | Authentication | `POST setup`, `POST unlock`, `POST lock`, `POST refresh`, `POST enable`, `POST disable`, `POST anonymous-readonly` |
| `/api/security` | Security status | `GET /api/security` |
| `/api/wrappers` | Wrapper management | `GET list`, `POST install`, `DELETE`, `PUT update`, `POST sync`, `POST regenerate`, `POST custom` |
| `/api/skills` | Skill management | `GET list`, `GET quarantined`, `POST analyze`, `POST approve`, `DELETE reject`, `POST revoke`, `PUT toggle` |
| `/api/marketplace` | Skill marketplace | `GET search`, `GET details`, `POST analyze`, `POST install` |
| `/api/secrets` | Secrets management | `GET list`, `GET env`, `GET skill-env`, `POST create`, `PATCH update`, `DELETE` |
| `/api/exec` | Execution control | `GET system-bins`, `GET/POST/DELETE allowed-commands` |
| `/api/discovery` | System discovery | `GET /api/discovery/scan` |
| `/api/activity` | Activity log | `GET /api/activity` |
| `/api/agenco` | AgenCo integration | OAuth flow, MCP activation, tool execution, integrations |
| `/api/openclaw` | OpenClaw management | `GET status`, `POST start`, `POST stop`, `POST restart`, `GET dashboard-url` |
| `/api/fs` | Filesystem browsing | `GET /api/fs/browse` |
| `/sse/events` | Server-Sent Events | Real-time event stream (filterable by prefix) |
| `/rpc` | JSON-RPC 2.0 | Interceptor communication (`policy_check`, `events_batch`, `http_request`, `ping`) |

### SSE Event Categories

| Category | Events |
|----------|--------|
| `security:` | `status`, `warning`, `critical`, `alert` |
| `skills:` | `quarantined`, `untrusted_detected`, `approved`, `analyzed`, `analysis_failed`, `install_started`, `install_progress`, `installed`, `install_failed`, `uninstalled` |
| `wrappers:` | `installed`, `uninstalled`, `updated`, `custom_added`, `custom_removed`, `synced`, `regenerated` |
| `broker:` | `request`, `response` |
| `exec:` | `monitored`, `denied` |
| `agenco:` | `connected`, `disconnected`, `auth_required`, `auth_completed`, `tool_executed`, `error` |
| `config:` | `changed` |
| `api:` | `request`, `outbound` |
| `interceptor:` | `event` |
| `process:` | `started`, `stopped` |
| `daemon:` | `status` |
| | `heartbeat` |

</details>

<details>
<summary><strong>Development Environment Variables</strong></summary>

| Variable | Description | Default |
|----------|-------------|---------|
| `AGENSHIELD_AGENT_HOME` | Override agent home (for dev) | `./tmp/dev-agent` in `daemon:dev` |
| `AGENSHIELD_DRY_RUN` | Dry-run mode for setup | `false` |
| `AGENSHIELD_SKIP_CONFIRM` | Skip confirmation prompts | `false` |
| `AGENSHIELD_VERBOSE` | Verbose CLI output | `false` |
| `AGENSHIELD_PREFIX` | Custom prefix for users/groups | |
| `AGENSHIELD_BASE_NAME` | Base name for sandbox users/groups | |
| `AGENSHIELD_BASE_UID` | Base UID for created sandbox users | |
| `AGENSHIELD_TARGET` | Setup target environment | |
| `AGENSHIELD_ENTRY_POINT` | Entry point for execution | |
| `AGENSHIELD_BROKER_VERBOSE` | Verbose broker output | `false` |
| `AGENSHIELD_HTTP_PORT` | Broker HTTP fallback port | `5201` |
| `AGENSHIELD_HTTP_HOST` | Broker HTTP fallback host | `localhost` |
| `AGENSHIELD_HTTP_ENABLED` | Enable broker HTTP fallback | `true` |

</details>

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for full system diagrams including:

- Installation sequence (29-step wizard)
- Daemon startup and API routes
- Broker request flow and policy evaluation
- Sandbox isolation layers
- Interceptor architecture
- Seatbelt profile generation
- LaunchDaemon configuration

## Local npm Registry

For testing published packages locally:

```bash
yarn registry:start     # Start local Verdaccio registry
yarn registry:publish   # Publish all packages to local registry
yarn registry:stop      # Stop local registry
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Follow existing code patterns and conventions
4. Run `yarn lint && yarn format:check && yarn test` before submitting
5. Open a pull request

## License

[MIT](LICENSE)
