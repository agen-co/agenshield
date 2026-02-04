# @agenshield/patcher

Python network isolation via sitecustomize.py patching for AgenShield.

## Overview

This library provides Python runtime network isolation by injecting a `sitecustomize.py` file that patches Python's socket and HTTP libraries to route all network traffic through the AgenShield broker daemon.

## Installation

```bash
npm install @agenshield/patcher
```

## Usage

### Programmatic API

```typescript
import { PythonPatcher } from '@agenshield/patcher';

const patcher = new PythonPatcher({
  pythonPath: '/usr/bin/python3',
  brokerHost: 'localhost',
  brokerPort: 6969,
});

// Install the patcher
await patcher.install();

// Verify installation
const isPatched = await patcher.verify();

// Uninstall
await patcher.uninstall();
```

### Generate Wrapper Script

```typescript
import { generatePythonWrapper } from '@agenshield/patcher';

const wrapperScript = generatePythonWrapper({
  pythonPath: '/usr/bin/python3',
  useSandbox: true,  // Use macOS sandbox-exec
});

// Write to /Users/clawagent/bin/python
```

### Generate Seatbelt Profile

```typescript
import { generateSandboxProfile } from '@agenshield/patcher';

const profile = generateSandboxProfile({
  allowedPaths: ['/Users/clawagent/workspace'],
  brokerSocket: '/var/run/agenshield.sock',
});

// Write to /etc/agenshield/seatbelt/python.sb
```

## How It Works

### Sitecustomize.py Injection

Python automatically loads `sitecustomize.py` from the site-packages directory on startup. Our patched version:

1. Patches `socket.create_connection()` to block direct connections
2. Patches `urllib3.connection.HTTPConnection` to route through broker
3. Patches `requests.Session.request()` for requests library support
4. Allows only connections to `localhost:6969` (broker HTTP fallback)

### Network Flow

```
┌─────────────────────────────────────────────────────────┐
│                    Python Application                    │
│                                                          │
│  requests.get('https://api.example.com')                │
│  urllib.request.urlopen('https://...')                  │
│  socket.create_connection(('evil.com', 80))             │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│              sitecustomize.py Patches                    │
│                                                          │
│  • socket.create_connection → blocked (except localhost) │
│  • urllib3 → routed through broker HTTP                  │
│  • requests → routed through broker HTTP                 │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│              Broker HTTP Fallback (:6969)                │
│                                                          │
│  POST /api/proxy                                         │
│  { "url": "https://api.example.com", "method": "GET" }  │
└─────────────────────────────────────────────────────────┘
```

### Wrapper Script

For additional security, a wrapper script can:

1. Set `PYTHONPATH` to include our sitecustomize.py
2. Optionally run Python under `sandbox-exec` with a deny-network profile
3. Set environment variables for broker configuration

## Templates

### sitecustomize.py

The generated `sitecustomize.py` includes:

```python
# Network blocking
import socket
_original_create_connection = socket.create_connection

def _agenshield_create_connection(address, *args, **kwargs):
    host, port = address
    if host not in ('localhost', '127.0.0.1') or port != 6969:
        raise ConnectionRefusedError(
            f"AgenShield: Direct connections blocked. Use broker at localhost:6969"
        )
    return _original_create_connection(address, *args, **kwargs)

socket.create_connection = _agenshield_create_connection

# HTTP routing through broker
# ... (patches urllib3, requests, etc.)
```

### Seatbelt Profile (macOS)

```scheme
(version 1)
(deny default)

; Allow read-only access to Python installation
(allow file-read*
  (subpath "/usr/lib/python3")
  (subpath "/Library/Frameworks/Python.framework"))

; Allow workspace access
(allow file-read* file-write*
  (subpath "${WORKSPACE}"))

; Block all network except broker
(deny network*)
(allow network-outbound
  (remote tcp "localhost:6969"))
```

## Configuration

Environment variables recognized by sitecustomize.py:

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENSHIELD_BROKER_HOST` | `localhost` | Broker HTTP host |
| `AGENSHIELD_BROKER_PORT` | `6969` | Broker HTTP port |
| `AGENSHIELD_ENABLED` | `true` | Enable/disable patching |
| `AGENSHIELD_LOG_LEVEL` | `warn` | Logging level |

## Verification

After installation, verify patching works:

```bash
# This should fail (direct connection blocked)
python -c "import socket; socket.create_connection(('example.com', 80))"
# Expected: ConnectionRefusedError

# This should work (routed through broker)
python -c "import requests; print(requests.get('https://api.example.com').status_code)"
# Expected: 200 (if allowed by policy) or error (if denied)
```

## Rollback

To completely remove patching:

```typescript
import { PythonPatcher } from '@agenshield/patcher';

const patcher = new PythonPatcher({ pythonPath: '/usr/bin/python3' });

// Remove sitecustomize.py
await patcher.uninstall();

// Restore original Python (if wrapper was installed)
await patcher.restoreOriginal();
```

## Limitations

- Only works with Python 3.6+
- Requires write access to Python's site-packages directory
- Some native extensions that bypass Python's socket module may not be intercepted
- asyncio networking requires additional patches (included by default)

## License

MIT
