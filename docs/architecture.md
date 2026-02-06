# AgenShield Architecture

> **Version**: 1.0.0
> **Status**: Production-Ready Implementation
> **Last Updated**: 2026-02-04

---

## Executive Summary

AgenShield is a security framework for AI agents that provides network isolation, policy enforcement, and secure operation proxying. It uses a two-user isolation model with Unix socket IPC as the primary communication channel.

---

## 1. OS Scope

**Target Platform**: macOS only (Darwin)

**System Dependencies**:
- `dscl` - Directory Service command line utility for user/group management
- `sandbox-exec` - macOS Seatbelt sandbox execution
- `launchctl` - Launch daemon management

**Minimum Requirements**:
- macOS 12.0 (Monterey) or later
- Node.js 22.0.0 or later
- Administrator (sudo) access for installation

---

## 2. User Model

### Two-User Isolation Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         ROOT LEVEL                              │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              agenshield daemon (root)                    │   │
│  │         Privileged operations, user management           │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
          ┌───────────────────┴───────────────────┐
          ▼                                       ▼
┌─────────────────────┐               ┌─────────────────────┐
│     clawagent       │               │     clawbroker      │
│     (UID 5200)      │               │     (UID 5201)      │
│                     │               │                     │
│  • Runs AI agent    │    Socket     │  • Runs broker      │
│  • NO network       │◄─────────────►│  • HAS network      │
│  • Guarded shell    │     IPC       │  • Policy enforce   │
│  • Workspace only   │               │  • Audit logging    │
└─────────────────────┘               └─────────────────────┘
         │                                     │
         │                                     │
    ┌────┴────┐                          ┌────┴────┐
    │Seatbelt │                          │ HTTP    │
    │Profile  │                          │Fallback │
    │(deny-net)│                         │:5200    │
    └─────────┘                          └─────────┘
```

### User Details

| User | UID | Purpose | Network | Shell |
|------|-----|---------|---------|-------|
| `clawagent` | 5200 | Runs AI agent code | **Denied** | `/usr/local/bin/guarded-shell` |
| `clawbroker` | 5201 | Runs broker daemon | **Allowed** | `/bin/bash` |

### Group Details

| Group | GID | Purpose | Members |
|-------|-----|---------|---------|
| `clawshield` | 5100 | Socket access | clawagent, clawbroker |
| `clawworkspace` | 5101 | Workspace file access | clawagent |

---

## 3. IPC Architecture

### Primary: Unix Socket

**Path**: `/var/run/agenshield.sock`

**Properties**:
- Owner: `clawbroker:clawshield`
- Permissions: `srwxrwx---` (770)
- Protocol: JSON-RPC 2.0 over newline-delimited JSON

**Allowed Operations** (all operations):
- `http_request` - Proxied HTTP requests
- `file_read` - Read files with policy check
- `file_write` - Write files with policy check
- `file_list` - List directory contents
- `exec` - Execute commands with policy check
- `open_url` - Open URLs in browser
- `secret_inject` - Inject secrets into environment
- `ping` - Health check

### Fallback: HTTP

**Endpoint**: `http://localhost:5200`

**Properties**:
- Only accessible from localhost
- Restricted operation set
- Used by Python runtime (sitecustomize.py)

**Restricted Operations** (subset only):
- `http_request` - Proxied HTTP requests
- `file_read` - Read files (policy checked)
- `file_list` - List directories
- `ping` - Health check

**Denied over HTTP**:
- `exec` - Command execution
- `file_write` - File writing
- `secret_inject` - Secret injection

### IPC Decision Matrix

| Operation | Unix Socket | HTTP Fallback |
|-----------|-------------|---------------|
| http_request | ✅ | ✅ |
| file_read | ✅ | ✅ |
| file_write | ✅ | ❌ |
| file_list | ✅ | ✅ |
| exec | ✅ | ❌ |
| open_url | ✅ | ✅ |
| secret_inject | ✅ | ❌ |
| ping | ✅ | ✅ |

---

## 4. Canonical Paths

### System Directories

```
/var/run/agenshield/
└── agenshield.sock          # Unix domain socket

/var/log/agenshield/
├── broker.log               # Broker stdout
├── broker.error.log         # Broker stderr
└── audit.log                # Security audit log

/opt/agenshield/
├── config/                  # Runtime configuration
│   └── shield.json          # Main config file
├── policies/                # Policy definitions
│   ├── default.json         # Default policies
│   └── custom/              # User policies
└── ops/                     # Operation logs

/etc/agenshield/
├── seatbelt/                # Sandbox profiles
│   ├── agent.sb             # Agent profile
│   └── ops/                 # Per-operation profiles
├── backup.json              # Installation backup
└── vault.enc                # Encrypted secrets
```

### User Directories

```
/Users/clawagent/
├── bin/                     # Broker wrappers
│   ├── shieldctl            # Control CLI
│   ├── curl                 # curl wrapper
│   ├── wget                 # wget wrapper
│   ├── git                  # git wrapper
│   ├── npm                  # npm wrapper
│   ├── pip                  # pip wrapper
│   ├── python               # python wrapper
│   └── node                 # node wrapper
├── workspace/               # Working directory (setgid)
│   └── ...                  # Agent files
└── .openclaw-pkg/           # OpenClaw package
```

---

## 5. OpenClaw Detection

AgenShield detects OpenClaw installations in the following order:

### Detection Priority

1. **npm global** (`npm root -g`)
   ```
   /usr/local/lib/node_modules/openclaw
   /opt/homebrew/lib/node_modules/openclaw
   ~/.npm-global/lib/node_modules/openclaw
   ```

2. **npm local** (project node_modules)
   ```
   ./node_modules/openclaw
   ./node_modules/.bin/openclaw
   ```

3. **git clone**
   ```
   ~/openclaw
   ~/git/openclaw
   ~/.local/share/openclaw
   ```

### Detection Algorithm

```typescript
async function detectOpenClaw(): Promise<OpenClawInstallation | null> {
  // 1. Check npm global
  const globalRoot = await exec('npm root -g');
  if (await exists(join(globalRoot, 'openclaw'))) {
    return { type: 'npm-global', path: join(globalRoot, 'openclaw') };
  }

  // 2. Check npm local
  if (await exists('./node_modules/openclaw')) {
    return { type: 'npm-local', path: './node_modules/openclaw' };
  }

  // 3. Check git clone locations
  for (const dir of GIT_CLONE_PATHS) {
    if (await exists(dir) && await isOpenClawRepo(dir)) {
      return { type: 'git-clone', path: dir };
    }
  }

  return null;
}
```

---

## 6. Security Model

### Defense in Depth

```
Layer 1: Seatbelt (macOS Sandbox)
├── Network denial at kernel level
├── File system restrictions
└── Process isolation

Layer 2: User Isolation
├── Separate UID/GID
├── No sudo access
└── Guarded shell

Layer 3: Policy Enforcement
├── Operation allowlists
├── Path restrictions
└── Host/port allowlists

Layer 4: Audit Logging
├── All operations logged
├── Policy violations tracked
└── Real-time monitoring
```

### Seatbelt Profile (agent.sb)

```scheme
(version 1)
(deny default)

; Allow read access to system libraries
(allow file-read*
  (subpath "/System")
  (subpath "/usr/lib")
  (subpath "/Library/Frameworks"))

; Allow workspace access
(allow file-read* file-write*
  (subpath "/Users/clawagent/workspace"))

; Allow socket access to broker
(allow network-outbound
  (local unix-socket "/var/run/agenshield.sock"))

; Deny all network
(deny network*)

; Allow process execution (limited)
(allow process-exec
  (subpath "/Users/clawagent/bin"))
```

---

## 7. Component Architecture

### Library Dependencies

```
┌─────────────────────────────────────────────────────────────┐
│                         cli                                 │
│                   (agenshield command)                      │
└─────────────────────────────────────────────────────────────┘
                    │           │           │
         ┌──────────┴───┐   ┌───┴───┐   ┌───┴──────────┐
         ▼              ▼   ▼       ▼   ▼              ▼
┌─────────────┐  ┌──────────┐  ┌──────────┐  ┌─────────────┐
│shield-daemon│  │shield-ipc│  │ shield-  │  │   shield-   │
│  (HTTP API) │  │ (types)  │  │ sandbox  │  │   broker    │
└─────────────┘  └──────────┘  └──────────┘  └─────────────┘
       │              │              │              │
       └──────────────┴──────────────┴──────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│shield-interceptor│ │  shield-patcher │  │  shield-skills  │
│   (Node.js)     │  │   (Python)      │  │  (OpenClaw)     │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

### Package Overview

| Package | Purpose | Binary |
|---------|---------|--------|
| `@agenshield/ipc` | Shared types, schemas, constants | - |
| `@agenshield/daemon` | HTTP daemon server | `agenshield-daemon` |
| `@agenshield/sandbox` | User isolation, seatbelt profiles | - |
| `@agenshield/broker` | Unix socket server, operation handlers | `agenshield-broker` |
| `@agenshield/interceptor` | Node.js runtime interception | - |
| `@agenshield/patcher` | Python network isolation | - |
| `@agenshield/skills` | OpenClaw skills integration | - |
| `agenshield` | CLI tool | `agenshield` |

---

## 8. Data Flow

### Request Flow (Agent → Network)

```
1. Agent code calls fetch('https://api.example.com')
   │
2. Interceptor catches the call
   │
3. Interceptor connects to /var/run/agenshield.sock
   │
4. Broker receives JSON-RPC request:
   │  { "method": "http_request", "params": { "url": "..." } }
   │
5. Broker checks policies:
   │  - Is api.example.com in allowlist?
   │  - Is this operation type allowed?
   │
6. If allowed:
   │  - Broker makes actual HTTP request
   │  - Returns response to interceptor
   │  - Interceptor returns to agent
   │
7. If denied:
   │  - Log policy violation
   │  - Return error to interceptor
   │  - Interceptor throws SecurityError
```

### Secret Injection Flow

```
1. Agent requests secret via shieldctl:
   │  shieldctl secret get API_KEY
   │
2. shieldctl connects to socket:
   │  { "method": "secret_inject", "params": { "name": "API_KEY" } }
   │
3. Broker retrieves from vault.enc:
   │  - Decrypts with machine key
   │  - Validates operation context
   │
4. Broker returns secret value:
   │  - Only to socket (never HTTP)
   │  - Logged in audit.log (redacted)
   │
5. Agent receives secret value
```

---

## 9. Policy Model

### Policy Structure

```typescript
interface PolicyRule {
  id: string;                    // Unique identifier
  name: string;                  // Human-readable name
  type: 'allowlist' | 'denylist';
  operations: OperationType[];   // Which operations this applies to
  patterns: string[];            // Glob or regex patterns
  enabled: boolean;
  priority: number;              // Higher = evaluated first
}

interface PolicyConfig {
  version: string;
  rules: PolicyRule[];
  defaultAction: 'allow' | 'deny';
  fsConstraints: FsConstraints;
  networkConstraints: NetworkConstraints;
  envInjection: EnvInjectionRule[];
}
```

### Default Policies

```json
{
  "version": "1.0.0",
  "defaultAction": "deny",
  "rules": [
    {
      "id": "allow-localhost",
      "name": "Allow localhost connections",
      "type": "allowlist",
      "operations": ["http_request"],
      "patterns": ["localhost:*", "127.0.0.1:*"],
      "enabled": true,
      "priority": 100
    },
    {
      "id": "deny-secrets",
      "name": "Deny access to secret files",
      "type": "denylist",
      "operations": ["file_read", "file_write"],
      "patterns": ["**/.env*", "**/secrets.*", "**/*.key"],
      "enabled": true,
      "priority": 200
    }
  ],
  "fsConstraints": {
    "allowedPaths": ["/Users/clawagent/workspace"],
    "deniedPatterns": ["/etc/passwd", "/etc/shadow"]
  },
  "networkConstraints": {
    "allowedHosts": ["api.anthropic.com", "api.openai.com"],
    "deniedHosts": ["*"],
    "allowedPorts": [80, 443]
  }
}
```

---

## 10. LaunchDaemon Configuration

### Broker Daemon Plist

**Path**: `/Library/LaunchDaemons/com.agenshield.broker.plist`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.agenshield.broker</string>

    <key>ProgramArguments</key>
    <array>
        <string>/opt/agenshield/bin/agenshield-broker</string>
    </array>

    <key>UserName</key>
    <string>clawbroker</string>

    <key>GroupName</key>
    <string>clawshield</string>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>StandardOutPath</key>
    <string>/var/log/agenshield/broker.log</string>

    <key>StandardErrorPath</key>
    <string>/var/log/agenshield/broker.error.log</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>AGENSHIELD_CONFIG</key>
        <string>/opt/agenshield/config/shield.json</string>
        <key>AGENSHIELD_SOCKET</key>
        <string>/var/run/agenshield.sock</string>
    </dict>
</dict>
</plist>
```

---

## 11. Verification Commands

After installation, verify the setup with:

```bash
# Groups created
dscl . -read /Groups/clawshield
dscl . -read /Groups/clawworkspace

# Users created
dscl . -read /Users/clawagent
dscl . -read /Users/clawbroker

# Socket permissions
ls -la /var/run/agenshield/

# Daemon running
launchctl list | grep agenshield
curl http://localhost:5200/api/health

# Agent network blocked
sudo -u clawagent curl https://example.com
# Expected: Connection refused

# Broker allows via wrapper
sudo -u clawagent /Users/clawagent/bin/shieldctl request ping
# Expected: pong
```

---

## Appendix A: Error Codes

| Code | Name | Description |
|------|------|-------------|
| 1001 | POLICY_DENIED | Operation blocked by policy |
| 1002 | AUTH_FAILED | Socket authentication failed |
| 1003 | INVALID_OP | Unknown operation type |
| 1004 | NETWORK_ERROR | Upstream network error |
| 1005 | FS_ERROR | File system error |
| 1006 | EXEC_ERROR | Command execution error |
| 1007 | SECRET_NOT_FOUND | Secret not in vault |
| 1008 | CHANNEL_RESTRICTED | Operation not allowed on channel |

---

## Appendix B: Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| AGENSHIELD_CONFIG | /opt/agenshield/config/shield.json | Config file path |
| AGENSHIELD_SOCKET | /var/run/agenshield.sock | Unix socket path |
| AGENSHIELD_HTTP_PORT | 5200 | HTTP fallback port |
| AGENSHIELD_LOG_LEVEL | info | Logging level |
| AGENSHIELD_FAIL_OPEN | false | Allow on daemon failure |
