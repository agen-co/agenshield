# @agenshield/patcher

Python network isolation via `sitecustomize.py` patching and optional macOS seatbelt wrappers. This package installs a Python runtime patch that blocks direct network access and routes selected HTTP traffic through the AgenShield broker.

## Purpose
- Prevent direct outbound network calls from Python code.
- Route `requests` traffic through the broker HTTP fallback.
- Optionally wrap Python with `sandbox-exec` on macOS.

## Key Components
- `src/install.ts` - `PythonPatcher` (install/uninstall/isInstalled).
- `src/verify.ts` - `PythonVerifier` to validate the patch.
- `src/python/sitecustomize.ts` - Generates patched `sitecustomize.py`.
- `src/python/wrapper.ts` - Generates a wrapper shell script.
- `src/python/sandbox-profile.ts` - Generates a macOS seatbelt profile.

## Usage
### Install
```ts
import { PythonPatcher } from '@agenshield/patcher';

const patcher = new PythonPatcher({
  pythonPath: '/usr/bin/python3',
  brokerHost: 'localhost',
  brokerPort: 5200,
  useSandbox: true,
  workspacePath: '/Users/clawagent/workspace',
  socketPath: '/var/run/agenshield.sock',
  installDir: '/Users/clawagent/bin'
});

const result = await patcher.install();
```

### Verify
```ts
import { PythonVerifier } from '@agenshield/patcher';

const verifier = new PythonVerifier({ pythonPath: '/usr/bin/python3' });
const report = await verifier.verify();
```

### Generate Assets
```ts
import { generateSitecustomize, generatePythonWrapper, generateSandboxProfile } from '@agenshield/patcher';

const sitecustomize = generateSitecustomize({
  brokerHost: 'localhost',
  brokerPort: 5200,
  logLevel: 'warn',
  enabled: true,
});

const wrapper = generatePythonWrapper({
  pythonPath: '/usr/bin/python3',
  sitecustomizePath: '/path/to/sitecustomize.py',
  useSandbox: true,
  sandboxProfilePath: '/etc/agenshield/seatbelt/python.sb',
});

const profile = generateSandboxProfile({
  workspacePath: '/Users/clawagent/workspace',
  pythonPath: '/usr/bin/python3',
  brokerHost: 'localhost',
  brokerPort: 5200,
});
```

## How the Patch Works
- `socket.connect` and `socket.create_connection` are overridden to allow only broker connections.
- `requests.Session.request` is patched to proxy HTTP requests through the broker (`/rpc`).
- `urllib3` is patched to *block* non-broker connections (it does not proxy).
- `aiohttp` is patched to *block* non-broker connections.

## Environment Variables (sitecustomize)
- `AGENSHIELD_ENABLED` - `true`/`false` to toggle patching.
- `AGENSHIELD_BROKER_HOST` - Broker HTTP host.
- `AGENSHIELD_BROKER_PORT` - Broker HTTP port.
- `AGENSHIELD_LOG_LEVEL` - `debug|info|warn|error`.

## Limitations and Caveats
- Installs `sitecustomize.py` into the *system* site-packages; requires permissions.
- Virtual environments are not explicitly supported; `getsitepackages()[0]` may not be the active venv.
- Only `requests` is proxied through the broker; `urllib3` and `aiohttp` are blocked rather than proxied.
- macOS-only sandboxing (`sandbox-exec`) is used when `useSandbox` is true.
- Wrapper scripts do not remove seatbelt profiles on uninstall.
- The wrapper sets `PYTHONPATH` to a file path; site-packages installation is the primary mechanism.

## Roadmap (Ideas)
- Venv-aware installation and uninstall.
- Proxy support for `urllib3` and `aiohttp`.
- Cross-platform sandboxing alternatives.
- Cleaner wrapper env handling and profile lifecycle management.

## Development
```bash
# Build
npx nx build shield-patcher
```

## Contribution Guide
- Keep generated Python output minimal and deterministic.
- Any changes to `sitecustomize.py` should include a verifier update.
- Ensure new patches fail closed by default.

## Agent Notes
- `PythonPatcher.install()` writes to site-packages and optionally creates a wrapper and seatbelt profile.
- `PythonVerifier.verify()` uses real network probes; keep timeouts reasonable.
- `generateSandboxProfile()` emits a restrictive policy; any new paths should be explicit.
