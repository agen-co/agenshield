# AgenShield Architecture

This document describes the architecture of AgenShield, a security sandbox for AI agents running on macOS.

## Table of Contents

- [System Overview](#system-overview)
- [Installation Sequence](#installation-sequence)
- [Daemon Architecture](#daemon-architecture)
- [Policy Update Mechanism](#policy-update-mechanism)
- [Broker Request Flow](#broker-request-flow)
- [AgentLink Skill Flow](#agentlink-skill-flow)
- [Sandbox Architecture](#sandbox-architecture)

---

## System Overview

AgenShield provides a multi-layer security sandbox that isolates AI agents from the host system while allowing controlled access to resources through a policy-enforced broker.

```mermaid
graph TB
    subgraph "User Space"
        User[User]
        CLI[agenshield CLI]
        UI[Dashboard UI]
    end

    subgraph "Daemon Layer"
        Daemon[shield-daemon<br/>:3847]
    end

    subgraph "Broker Layer"
        Broker[shield-broker<br/>Unix Socket + HTTP]
        Policy[PolicyEnforcer]
        Audit[AuditLogger]
        Vault[SecretVault]
    end

    subgraph "Sandbox"
        Agent[AI Agent<br/>clawagent user]
        Wrappers[Command Wrappers<br/>curl, python, node]
        Seatbelt[Seatbelt Profile<br/>macOS Sandbox]
    end

    subgraph "External"
        Network[Network]
        FS[File System]
        Exec[System Commands]
    end

    User --> CLI
    User --> UI
    UI --> Daemon
    CLI --> Daemon

    Daemon --> Broker
    Agent --> Wrappers
    Wrappers --> Broker
    Agent --> Seatbelt

    Broker --> Policy
    Broker --> Audit
    Broker --> Vault

    Policy -->|allowed| Network
    Policy -->|allowed| FS
    Policy -->|allowed| Exec
```

### Component Relationships

| Component | Role | Communication |
|-----------|------|---------------|
| **CLI** | Installation, configuration, status | Direct system calls |
| **Daemon** | HTTP API, real-time events, UI serving | HTTP REST + SSE |
| **Broker** | Request mediation, policy enforcement | Unix Socket + HTTP fallback |
| **Sandbox** | Agent isolation, network blocking | Seatbelt profiles, user isolation |

### Key Files

- `/libs/cli/` - Command-line interface
- `/libs/shield-daemon/` - Management daemon
- `/libs/shield-broker/` - Request broker
- `/libs/shield-sandbox/` - Sandbox utilities
- `/libs/shield-ipc/` - Shared types and schemas

---

## Installation Sequence

The setup wizard runs in two phases: detection (automatic) and setup (after user confirmation).

### Phase 1: Detection

```mermaid
sequenceDiagram
    participant User
    participant CLI as agenshield setup
    participant Engine as WizardEngine
    participant Sandbox as @agenshield/sandbox

    User->>CLI: sudo agenshield setup
    CLI->>Engine: createWizardEngine()
    CLI->>Engine: runDetectionPhase()

    Engine->>Sandbox: checkPrerequisites()
    Sandbox-->>Engine: Node.js 22+, macOS, tools

    Engine->>Sandbox: autoDetectPreset()
    Note right of Sandbox: Checks for OpenClaw<br/>or custom target
    Sandbox-->>Engine: preset, detection result

    Engine->>Sandbox: createUserConfig()
    Engine->>Sandbox: createPathsConfig()
    Sandbox-->>Engine: userConfig, pathsConfig

    Engine-->>CLI: Detection complete
    CLI->>User: Show plan, request confirmation
```

### Phase 2: Setup (17 Steps)

```mermaid
sequenceDiagram
    participant User
    participant Engine as WizardEngine
    participant Sandbox as @agenshield/sandbox
    participant System as macOS

    User->>Engine: Confirm setup

    rect rgb(240, 240, 250)
        Note over Engine,System: User & Group Creation
        Engine->>Sandbox: backup configs
        Engine->>Sandbox: createGroups()
        Sandbox->>System: dscl create clawsocket, clawworkspace
        Engine->>Sandbox: createAgentUser()
        Sandbox->>System: dscl create clawagent (uid 399)
        Engine->>Sandbox: createBrokerUser()
        Sandbox->>System: dscl create clawbroker (uid 398)
    end

    rect rgb(250, 240, 240)
        Note over Engine,System: Directory Setup
        Engine->>Sandbox: createAllDirectories()
        Sandbox->>System: mkdir /opt/agenshield, /etc/agenshield, etc.
        Engine->>Sandbox: setupSocketDirectory()
        Sandbox->>System: mkdir /var/run/agenshield (mode 0770)
    end

    rect rgb(240, 250, 240)
        Note over Engine,System: Security Profiles
        Engine->>Sandbox: generateAgentProfile()
        Sandbox-->>Engine: Seatbelt .sb content
        Engine->>Sandbox: installSeatbeltProfiles()
        Sandbox->>System: Write to /etc/agenshield/seatbelt/
    end

    rect rgb(250, 250, 240)
        Note over Engine,System: Component Installation
        Engine->>Sandbox: installAllWrappers()
        Sandbox->>System: Install curl, python, node wrappers
        Engine->>Sandbox: install broker, daemon config, policies
        Engine->>Sandbox: generateBrokerPlist()
        Engine->>Sandbox: installLaunchDaemon()
        Sandbox->>System: launchctl load broker.plist
    end

    rect rgb(240, 250, 250)
        Note over Engine,System: Migration & Verification
        Engine->>Sandbox: preset.migrate()
        Sandbox->>System: Move target to sandbox, create bin link
        Engine->>Sandbox: verifyUsersAndGroups()
        Engine->>Sandbox: verifyDirectories()
        Sandbox-->>Engine: All checks passed
    end

    Engine-->>User: Setup complete!
```

### Wizard Step Reference

| Step ID | Name | Description |
|---------|------|-------------|
| `prerequisites` | Check Prerequisites | Verify Node.js 22+, macOS, required tools |
| `detect` | Detect Target | Find OpenClaw or custom target |
| `configure` | Configure | Set up user configuration |
| `confirm` | Confirm Setup | Show plan, get user confirmation |
| `backup` | Backup Installation | Save backup for safe reversal |
| `create-groups` | Create Groups | Create socket and workspace groups |
| `create-agent-user` | Create Agent User | Create sandboxed agent user |
| `create-broker-user` | Create Broker User | Create broker daemon user |
| `create-directories` | Create Directories | Create /opt/agenshield, /etc/agenshield |
| `setup-socket` | Setup Socket | Create /var/run/agenshield/ |
| `generate-seatbelt` | Generate Seatbelt | Generate macOS sandbox profiles |
| `install-wrappers` | Install Wrappers | Install command wrappers |
| `install-broker` | Install Broker | Install broker binary |
| `install-daemon-config` | Install Daemon Config | Write daemon configuration |
| `install-policies` | Install Policies | Write default security policies |
| `setup-launchdaemon` | Setup LaunchDaemon | Create and load launchd plist |
| `migrate` | Migrate Installation | Move target to sandbox |
| `verify` | Verify Installation | Test sandboxed application |
| `complete` | Complete | Setup finished |

**Key Files:**
- `/libs/cli/src/commands/setup.ts`
- `/libs/cli/src/wizard/engine.ts`
- `/libs/cli/src/wizard/types.ts`

---

## Daemon Architecture

The shield-daemon provides a management API and real-time event streaming.

### Startup Flow

```mermaid
sequenceDiagram
    participant Main as main.ts
    participant Config as ConfigLoader
    participant Server as Fastify Server
    participant Watcher as SecurityWatcher

    Main->>Config: ensureConfigDir()
    Main->>Config: loadConfig()
    Config-->>Main: DaemonConfig

    Main->>Main: Write PID file
    Main->>Main: Register SIGINT/SIGTERM handlers

    Main->>Server: startServer(config)
    Server->>Server: createServer(config)
    Server->>Server: Register CORS
    Server->>Server: registerRoutes()

    Note over Server: Routes registered:<br/>/api/health<br/>/api/status<br/>/api/config<br/>/api/security<br/>/api/wrappers<br/>/sse/events

    Server->>Server: Serve static UI assets

    Server->>Watcher: startSecurityWatcher(10000ms)
    Watcher-->>Server: Monitoring started

    Server->>Server: listen(port, host)
    Server-->>Main: Server ready

    Main-->>Main: Log startup message
```

### HTTP API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check |
| `/api/status` | GET | Daemon and broker status |
| `/api/config` | GET | Get current configuration |
| `/api/config` | PUT | Update configuration |
| `/api/security` | GET | Security status (users, processes) |
| `/api/wrappers` | GET | Installed wrapper status |
| `/sse/events` | GET | Server-Sent Events stream |

### SSE Events

```typescript
type EventType =
  | 'security_status'  // Security check results
  | 'api_request'      // API traffic
  | 'connected';       // Initial connection
```

**Key Files:**
- `/libs/shield-daemon/src/main.ts`
- `/libs/shield-daemon/src/server.ts`
- `/libs/shield-daemon/src/config/loader.ts`
- `/libs/shield-daemon/src/routes/`

---

## Policy Update Mechanism

Policies control what operations the broker allows.

### Policy Structure

```typescript
interface PolicyConfig {
  version: string;
  defaultAction: 'allow' | 'deny';
  rules: PolicyRule[];
  fsConstraints?: {
    allowedPaths: string[];
    deniedPatterns: string[];
  };
  networkConstraints?: {
    allowedHosts: string[];
    deniedHosts: string[];
    allowedPorts: number[];
  };
}

interface PolicyRule {
  id: string;
  name: string;
  type: 'allowlist' | 'denylist';
  operations: string[];  // e.g., ['http_request', 'file_read']
  patterns: string[];    // Glob patterns for targets
  enabled: boolean;
  priority: number;      // Higher = evaluated first
}
```

### Policy Evaluation Flow

```mermaid
sequenceDiagram
    participant Client
    participant Broker
    participant Enforcer as PolicyEnforcer
    participant Disk

    Client->>Broker: Operation request

    Broker->>Enforcer: check(operation, params, context)

    Enforcer->>Enforcer: maybeReload()<br/>(if stale > 60s)

    alt Policies stale
        Enforcer->>Disk: Load default.json
        Enforcer->>Disk: Load custom/*.json
        Enforcer->>Enforcer: Sort by priority
    end

    Enforcer->>Enforcer: Extract target from params
    Enforcer->>Enforcer: Evaluate rules (priority order)

    alt Rule matches
        alt Denylist rule
            Enforcer-->>Broker: {allowed: false, reason}
        else Allowlist rule
            Enforcer-->>Broker: {allowed: true, policyId}
        end
    else No rule matches
        Enforcer->>Enforcer: Check fsConstraints
        Enforcer->>Enforcer: Check networkConstraints
        Enforcer-->>Broker: {allowed: defaultAction}
    end

    Broker-->>Client: Response
```

### Configuration Update via API

```mermaid
sequenceDiagram
    participant UI
    participant Daemon as /api/config
    participant Disk

    UI->>Daemon: PUT /api/config<br/>{policies: {...}}

    Daemon->>Daemon: Validate schema
    Daemon->>Disk: Merge with existing config
    Daemon->>Disk: Write to daemon.json

    Daemon-->>UI: {success: true, config}

    Note over Daemon: PolicyEnforcer will<br/>reload on next check<br/>(within 60s)
```

**Key Files:**
- `/libs/shield-daemon/src/routes/config.ts`
- `/libs/shield-broker/src/policies/enforcer.ts`
- `/libs/shield-ipc/src/schemas/policy.schema.ts`

---

## Broker Request Flow

The broker mediates all operations from the sandboxed agent.

### Request Processing

```mermaid
sequenceDiagram
    participant Agent as AI Agent
    participant Wrapper as curl wrapper
    participant Client as BrokerClient
    participant Server as UnixSocketServer
    participant Policy as PolicyEnforcer
    participant Handler
    participant Audit as AuditLogger
    participant External as External Service

    Agent->>Wrapper: curl https://api.example.com
    Wrapper->>Client: http_request(url, method, headers)

    Client->>Server: JSON-RPC Request<br/>(via Unix Socket)

    Server->>Server: Parse JSON-RPC
    Server->>Server: Create HandlerContext

    Server->>Policy: check(operation, params, context)

    alt Policy Denied
        Policy-->>Server: {allowed: false, reason}
        Server->>Audit: log(denied)
        Server-->>Client: Error response
        Client-->>Wrapper: Error
        Wrapper-->>Agent: Exit code 1
    else Policy Allowed
        Policy-->>Server: {allowed: true, policyId}

        Server->>Handler: handleHttpRequest(params, context)
        Handler->>External: HTTP request
        External-->>Handler: Response

        Handler-->>Server: {success: true, data}
        Server->>Audit: log(success)

        Server-->>Client: JSON-RPC Response
        Client-->>Wrapper: Response data
        Wrapper-->>Agent: stdout
    end
```

### Operation Types

| Operation | Description | Socket | HTTP |
|-----------|-------------|:------:|:----:|
| `http_request` | Proxy HTTP requests | ✓ | ✓ |
| `file_read` | Read file contents | ✓ | ✓ |
| `file_write` | Write file contents | ✓ | ✗ |
| `file_list` | List directory contents | ✓ | ✓ |
| `exec` | Execute system commands | ✓ | ✗ |
| `secret_inject` | Inject vault secrets | ✓ | ✗ |
| `open_url` | Open URL in browser | ✓ | ✓ |
| `ping` | Health check | ✓ | ✓ |

### Channel Restrictions

The HTTP fallback server is more restricted than the Unix socket for security:

```typescript
// HTTP Allowed
const HTTP_ALLOWED = ['http_request', 'file_read', 'file_list', 'open_url', 'ping'];

// HTTP Denied (socket-only)
const HTTP_DENIED = ['exec', 'file_write', 'secret_inject'];
```

**Key Files:**
- `/libs/shield-broker/src/server.ts` - Unix socket server
- `/libs/shield-broker/src/http-fallback.ts` - HTTP fallback server
- `/libs/shield-broker/src/policies/enforcer.ts`
- `/libs/shield-broker/src/client/broker-client.ts`
- `/libs/shield-ipc/src/types/ops.ts`

---

## AgentLink Skill Flow

AgentLink provides secure third-party integrations without exposing credentials to the AI agent.

### Authentication Flow

```mermaid
sequenceDiagram
    participant User
    participant CLI as agentlink auth
    participant Server as OAuth Callback
    participant Gateway as AgentLink Gateway
    participant Browser

    User->>CLI: agentlink auth

    CLI->>CLI: Check existing tokens

    alt No existing client
        CLI->>Gateway: POST /oauth/register<br/>(Dynamic Client Registration)
        Gateway-->>CLI: client_id, client_secret
    end

    CLI->>CLI: Generate PKCE<br/>(code_verifier, code_challenge)
    CLI->>CLI: Generate state

    CLI->>Server: Start callback server (:8765)
    CLI->>CLI: Build auth URL

    CLI->>Browser: Open auth URL
    Browser->>Gateway: Authorization request
    Gateway->>Browser: Login page

    User->>Browser: Authenticate

    Browser->>Server: Callback with code, state
    Server-->>CLI: code

    CLI->>CLI: Verify state

    CLI->>Gateway: POST /oauth/token<br/>(code, code_verifier, client_id, client_secret)
    Gateway-->>CLI: access_token, refresh_token

    CLI->>CLI: Store tokens securely

    CLI-->>User: Authentication successful!
```

### Tool Execution Flow

```mermaid
sequenceDiagram
    participant Agent as AI Agent
    participant Skill as AgentLink Skill
    participant TokenMgr as TokenManager
    participant Gateway as MCP Gateway

    Agent->>Skill: agentlink tool run slack send_message

    Skill->>TokenMgr: getValidToken()

    alt Token expired
        TokenMgr->>TokenMgr: refreshToken()
    end

    TokenMgr-->>Skill: access_token

    Skill->>Gateway: POST /mcp<br/>Authorization: Bearer {token}<br/>JSON-RPC: {method: "slack.send_message"}

    Note over Gateway: Gateway retrieves<br/>Slack credentials from<br/>secure vault

    Gateway-->>Skill: JSON-RPC Response

    Skill-->>Agent: Result
```

### Skill Injection During Setup

```mermaid
sequenceDiagram
    participant Setup as Setup Wizard
    participant Injector as SkillInjector
    participant FS as File System

    Setup->>Injector: injectAgentLinkSkill(config)

    Injector->>Injector: getAgentLinkSkillPath()
    Injector->>FS: Copy skill to ~/.openclaw/skills/

    Injector->>FS: npm install && npm run build

    Injector->>FS: chmod +x bin/agentlink.js

    Injector->>FS: chown -R clawagent:clawagent

    Setup->>Injector: createAgentLinkSymlink()
    Injector->>FS: ln -s skill/bin/agentlink.js ~/bin/agentlink

    Setup->>Injector: updateOpenClawMcpConfig()
    Injector->>FS: Update ~/.openclaw/mcp.json<br/>Add agentlink-marketplace server
```

**Key Files:**
- `/tools/agentlink-skill/src/commands/auth.ts`
- `/tools/agentlink-skill/src/commands/tool.ts`
- `/tools/agentlink-skill/src/lib/oauth-server.ts`
- `/tools/agentlink-skill/src/lib/token-manager.ts`
- `/libs/shield-sandbox/src/skill-injector.ts`

---

## Sandbox Architecture

The sandbox uses multiple isolation layers for defense in depth.

### Isolation Layers

```mermaid
graph TB
    subgraph "Layer 1: User Isolation"
        Agent[clawagent<br/>uid: 399]
        Broker[clawbroker<br/>uid: 398]
    end

    subgraph "Layer 2: Group Access Control"
        SocketGroup[clawsocket group<br/>Socket access]
        WorkspaceGroup[clawworkspace group<br/>Workspace access]
    end

    subgraph "Layer 3: Guarded Shell"
        Shell[Guarded zsh<br/>Restricted PATH]
    end

    subgraph "Layer 4: Seatbelt Profile"
        Deny[deny default]
        AllowRead[allow file-read*<br/>workspace only]
        AllowWrite[allow file-write*<br/>workspace only]
        AllowSocket[allow network*<br/>Unix socket only]
        DenyNet[deny network-outbound<br/>all Internet]
    end

    subgraph "Layer 5: Command Wrappers"
        Curl[curl wrapper]
        Python[python wrapper]
        Node[node wrapper]
    end

    subgraph "Layer 6: Python Patcher"
        SiteCustom[sitecustomize.py<br/>Network interception]
    end

    Agent --> SocketGroup
    Agent --> Shell
    Shell --> Deny
    Deny --> AllowRead
    Deny --> AllowWrite
    Deny --> AllowSocket
    Deny --> DenyNet

    Agent --> Curl
    Agent --> Python
    Agent --> Node

    Python --> SiteCustom
```

### User Hierarchy

```
root
├── clawbroker (uid: 398)
│   ├── Member of: clawsocket
│   ├── Home: /var/lib/agenshield/broker
│   └── Purpose: Runs broker daemon with elevated socket access
│
└── clawagent (uid: 399)
    ├── Member of: clawsocket, clawworkspace
    ├── Home: /var/lib/agenshield/agent
    ├── Shell: Guarded zsh (restricted PATH)
    └── Purpose: Runs sandboxed AI agent
```

### Directory Structure

```
/opt/agenshield/
├── bin/
│   └── agenshield-broker     # Broker binary
│
/etc/agenshield/
├── daemon.json               # Daemon configuration
├── policies/
│   ├── default.json          # Default policies
│   └── custom/               # Custom policy files
└── seatbelt/
    └── agent.sb              # Agent sandbox profile

/var/lib/agenshield/
├── agent/                    # Agent home
│   ├── bin/                  # Wrappers (curl, python, node)
│   ├── workspace/            # Agent workspace
│   └── .openclaw-pkg/        # Migrated OpenClaw package
│
└── broker/                   # Broker home

/var/run/agenshield/
└── broker.sock               # Unix socket (mode: 0770)

/var/log/agenshield/
├── broker.log
└── daemon.log
```

### Seatbelt Profile (Simplified)

```scheme
(version 1)
(deny default)

;; Allow reading from workspace
(allow file-read*
  (subpath "/var/lib/agenshield/agent/workspace"))

;; Allow writing to workspace
(allow file-write*
  (subpath "/var/lib/agenshield/agent/workspace"))

;; Allow Unix socket to broker
(allow network*
  (remote unix-socket
    (path-literal "/var/run/agenshield/broker.sock")))

;; Block all Internet access
(deny network-outbound
  (remote ip "*:*"))
```

### Wrapper Flow (curl example)

```mermaid
sequenceDiagram
    participant Agent as AI Agent
    participant Wrapper as curl wrapper
    participant Broker as Broker (Unix Socket)
    participant Internet

    Agent->>Wrapper: curl https://api.example.com

    Wrapper->>Wrapper: Parse arguments
    Wrapper->>Wrapper: Build JSON-RPC request

    Wrapper->>Broker: {"jsonrpc":"2.0","method":"http_request",...}

    Broker->>Broker: Policy check
    Broker->>Internet: Actual HTTP request
    Internet-->>Broker: Response

    Broker-->>Wrapper: {"jsonrpc":"2.0","result":{...}}

    Wrapper->>Wrapper: Format output
    Wrapper-->>Agent: HTTP response body
```

### Python Network Interception

The `sitecustomize.py` module is automatically loaded by Python and patches network modules:

```python
# Simplified concept
import urllib.request
import socket

_original_urlopen = urllib.request.urlopen

def _patched_urlopen(url, *args, **kwargs):
    # Route through broker
    return broker_http_request(url, *args, **kwargs)

urllib.request.urlopen = _patched_urlopen
```

**Key Files:**
- `/libs/shield-sandbox/src/guarded-shell.ts`
- `/libs/shield-sandbox/src/seatbelt.ts`
- `/libs/shield-sandbox/src/users.ts`
- `/libs/shield-sandbox/src/wrappers.ts`
- `/libs/shield-patcher/src/python/sitecustomize.ts`

---

## Security Model Summary

| Threat | Mitigation |
|--------|------------|
| Direct network access | Seatbelt blocks all outbound; wrappers route through broker |
| File system access | Seatbelt restricts to workspace; broker enforces policies |
| Privilege escalation | Unprivileged user (uid 399); no sudo |
| Command execution | Guarded shell; restricted PATH; broker policy for exec |
| Credential theft | AgentLink vault; secrets never reach agent |
| Policy bypass | Multiple layers; broker validates all requests |
| Configuration tampering | Config owned by root; agent has no write access |

---

## Quick Reference

### Start Services

```bash
# Start daemon (development)
npm run daemon

# Start broker via launchd
sudo launchctl load /Library/LaunchDaemons/com.agenshield.broker.plist
```

### Check Status

```bash
# CLI status
agenshield status

# API health
curl http://localhost:3847/api/health

# Broker ping
echo '{"jsonrpc":"2.0","id":1,"method":"ping"}' | nc -U /var/run/agenshield/broker.sock
```

### Configuration Locations

| File | Purpose |
|------|---------|
| `/etc/agenshield/daemon.json` | Daemon configuration |
| `/etc/agenshield/policies/default.json` | Default policies |
| `/var/lib/agenshield/agent/.openclaw/mcp.json` | Agent MCP config |
| `~/.agentlink/tokens.json` | AgentLink tokens (user) |
