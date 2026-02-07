# Dummy OpenClaw Test Harness

A minimal OpenClaw-like CLI for testing AgenShield sandbox enforcement without requiring a real OpenClaw installation.

## Purpose

This test harness allows you to:
- Test AgenShield installation without OpenClaw
- Verify sandbox enforcement (network, file, exec restrictions)
- Test with different user prefixes and configurations
- Run CI/CD tests without external dependencies

## Installation

### As npm global package (simulates `npm install -g openclaw`)

```bash
cd tools/test-harness
./scripts/install-as-npm.sh

# Verify
openclaw --version
# Output: 1.0.0-dummy
```

### As real `openclaw` package (for detection testing)

This installs the dummy at the exact npm global paths where `detect.ts` looks
for a real OpenClaw (`{npm-root}/openclaw/`), and copies skills into `~/.openclaw/`.

```bash
./scripts/install-as-openclaw.sh

# Verify detection
openclaw --version          # → 1.0.0-dummy
ls ~/.openclaw/skills/      # → geo-optimization  gog

# Uninstall
./scripts/uninstall-openclaw.sh               # keeps ~/.openclaw/
./scripts/uninstall-openclaw.sh --clean-config # also removes ~/.openclaw/
```

### As git clone (simulates `git clone`)

```bash
./scripts/install-as-git.sh /path/to/openclaw

# Verify
/path/to/openclaw/bin/dummy-openclaw.js --version
```

## Usage

### Check version and status

```bash
openclaw --version
openclaw status
```

### Test sandbox enforcement

```bash
# Test network access (should be BLOCKED in sandbox)
openclaw run --test-network

# Test file read (may be BLOCKED for sensitive files)
openclaw run --test-file /etc/passwd

# Test command execution
openclaw run --test-exec "whoami"

# Test file write
openclaw run --test-write /tmp/test.txt

# Run all tests with verbose output
openclaw run --test-network --test-file /etc/passwd --test-exec "whoami" --verbose
```

### Simulate chat (for compatibility testing)

```bash
openclaw chat
```

## Testing with AgenShield

### 1. Install dummy OpenClaw

```bash
cd tools/test-harness
./scripts/install-as-npm.sh
```

### 2. Run AgenShield detection

```bash
agenshield detect
# Should detect: npm global at /usr/local/lib/node_modules/dummy-openclaw
```

### 3. Install with test prefix

```bash
# Dry run first
sudo agenshield install --prefix=test1 --dry-run

# Actually install
sudo agenshield install --prefix=test1
```

### 4. Test sandbox enforcement

```bash
# As the test agent user
sudo -u test1_clawagent openclaw run --test-network
# Expected: Network: BLOCKED

sudo -u test1_clawagent openclaw run --test-file /etc/passwd
# Expected: File read: BLOCKED

# Test allowed operations through broker
sudo -u test1_clawagent /Users/test1_clawagent/bin/shieldctl request ping
# Expected: pong
```

### 5. Cleanup

```bash
# Uninstall AgenShield test installation
sudo agenshield uninstall --prefix=test1

# Uninstall dummy OpenClaw
./scripts/uninstall.sh
```

## Commands

| Command | Description |
|---------|-------------|
| `openclaw --version` | Show version (1.0.0-dummy) |
| `openclaw status` | Show environment and sandbox status |
| `openclaw config --show` | Show configuration |
| `openclaw run [options]` | Run with test behaviors |
| `openclaw chat` | Interactive chat (dummy) |
| `openclaw agent --task <task>` | Agentic mode (dummy) |

## Run Options

| Option | Description |
|--------|-------------|
| `--test-network` | Attempt HTTPS request to httpbin.org |
| `--test-file <path>` | Attempt to read specified file |
| `--test-write <path>` | Attempt to write to specified path |
| `--test-exec <cmd>` | Attempt to execute shell command |
| `--verbose` | Show detailed output |

## Expected Behavior

### Outside sandbox (normal user)

```
$ openclaw run --test-network --test-file /etc/passwd
Dummy OpenClaw running...

Testing network access...
  Network: SUCCESS (HTTP 200)

Testing file read: /etc/passwd
  File read: SUCCESS (1234 bytes)
```

### Inside sandbox (clawagent user)

```
$ sudo -u clawagent openclaw run --test-network --test-file /etc/passwd
Dummy OpenClaw running...

Testing network access...
  Network: BLOCKED (ECONNREFUSED)

Testing file read: /etc/passwd
  File read: BLOCKED (EACCES)
```

## Development

The test harness is intentionally simple JavaScript (no TypeScript compilation required) for easy debugging and modification.

Files:
- `bin/dummy-openclaw.js` - Main CLI entry point
- `scripts/install-as-npm.sh` - npm global installation (uses `npm link`, package name `dummy-openclaw`)
- `scripts/install-as-openclaw.sh` - Installs as `openclaw` at npm global paths (for `detect.ts` testing)
- `scripts/install-as-git.sh` - git clone simulation
- `scripts/uninstall.sh` - Cleanup for npm-link and git-clone installs
- `scripts/uninstall-openclaw.sh` - Cleanup for `install-as-openclaw.sh`
