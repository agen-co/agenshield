# AgenShield Verification Guide

This document provides step-by-step verification commands to ensure AgenShield is properly installed and functioning.

## Prerequisites Verification

```bash
# Check macOS version
sw_vers

# Expected: macOS 12.0 or later

# Check Node.js version
node --version

# Expected: v22.0.0 or later

# Check for administrator access
sudo -v

# Expected: Password prompt (you need sudo access)
```

## 1. Groups Verification

```bash
# Check clawshield group
dscl . -read /Groups/clawshield

# Expected output includes:
# PrimaryGroupID: 5100
# RealName: AgenShield socket access

# Check clawworkspace group
dscl . -read /Groups/clawworkspace

# Expected output includes:
# PrimaryGroupID: 5101
# RealName: AgenShield workspace access
```

## 2. Users Verification

```bash
# Check clawagent user
dscl . -read /Users/clawagent

# Expected output includes:
# UniqueID: 5200
# PrimaryGroupID: 5100
# UserShell: /usr/local/bin/guarded-shell
# NFSHomeDirectory: /Users/clawagent

# Check clawbroker user
dscl . -read /Users/clawbroker

# Expected output includes:
# UniqueID: 5201
# PrimaryGroupID: 5100
# UserShell: /bin/bash
```

## 3. Directory Structure Verification

```bash
# System directories
ls -la /opt/agenshield/
# Expected: config/, policies/, ops/, bin/

ls -la /etc/agenshield/
# Expected: seatbelt/, backup.json (if migrated)

ls -la /var/run/agenshield/
# Expected: drwxrwx--- clawbroker:clawshield

ls -la /var/log/agenshield/
# Expected: broker.log, broker.error.log, audit.log

# Agent directories
ls -la /Users/clawagent/
# Expected: bin/, workspace/, .openclaw-pkg/

ls -la /Users/clawagent/bin/
# Expected: shieldctl, curl, wget, git, npm, pip, python, node
```

## 4. Socket Permissions Verification

```bash
# Check socket directory
ls -la /var/run/agenshield/

# Expected:
# drwxrwx--- clawbroker clawshield

# When broker is running, check socket
ls -la /var/run/agenshield/agenshield.sock

# Expected:
# srwxrwx--- clawbroker clawshield
```

## 5. Daemon Status Verification

```bash
# Check if broker daemon is registered
launchctl list | grep agenshield

# Expected:
# -  0  com.agenshield.broker
# (The first column is PID, 0 means not running, number means running)

# Check daemon status
curl -s http://localhost:6969/api/health

# Expected:
# {"status":"ok","version":"0.1.0"}

# Check detailed status
curl -s http://localhost:6969/api/status

# Expected: JSON with daemon status information
```

## 6. Wrapper Verification

```bash
# Check installed wrappers
ls -la /Users/clawagent/bin/

# Expected executables:
# -rwxr-xr-x shieldctl
# -rwxr-xr-x curl
# -rwxr-xr-x wget
# -rwxr-xr-x git
# -rwxr-xr-x npm
# -rwxr-xr-x pip
# -rwxr-xr-x python
# -rwxr-xr-x node
# -rwxr-xr-x open-url

# Test shieldctl
/Users/clawagent/bin/shieldctl ping

# Expected: Pong! with version and timestamp
```

## 7. Network Isolation Verification

```bash
# Test direct network access (as clawagent) - should FAIL
sudo -u clawagent curl https://example.com

# Expected: Connection refused or blocked by sandbox

# Test broker-proxied request - should SUCCEED
sudo -u clawagent /Users/clawagent/bin/shieldctl http GET https://api.github.com

# Expected: HTTP response with status 200

# Test Python network isolation
sudo -u clawagent /Users/clawagent/bin/python -c "import socket; socket.create_connection(('example.com', 80))"

# Expected: ConnectionRefusedError: AgenShield: Direct connections blocked
```

## 8. Policy Enforcement Verification

```bash
# Test allowed operation
/Users/clawagent/bin/shieldctl http GET https://api.github.com

# Expected: Successful response

# Test denied file access (secrets)
sudo -u clawagent cat /etc/passwd

# Expected: Permission denied or blocked

# Check policy list
curl -s http://localhost:6969/api/policies

# Expected: JSON list of active policies
```

## 9. Secret Protection Verification

```bash
# Check environment for secrets (as clawagent)
sudo -u clawagent env | grep -E "(API_KEY|SECRET|TOKEN|PASSWORD)"

# Expected: Empty output (no secrets exposed)

# Verify vault exists
ls -la /etc/agenshield/vault.enc

# Expected: File exists with restricted permissions
```

## 10. Seatbelt Profile Verification

```bash
# Check installed profiles
ls -la /etc/agenshield/seatbelt/

# Expected:
# agent.sb
# ops/

ls -la /etc/agenshield/seatbelt/ops/

# Expected:
# file_read.sb
# file_write.sb
# http_request.sb
# exec.sb

# Verify profile syntax
cat /etc/agenshield/seatbelt/agent.sb | head -5

# Expected:
# (version 1)
# (deny default)
# ...
```

## 11. Audit Log Verification

```bash
# Check audit log exists
ls -la /var/log/agenshield/audit.log

# View recent audit entries
tail -10 /var/log/agenshield/audit.log

# Expected: JSON entries with operation, timestamp, allowed, etc.

# Check for denied operations
grep '"allowed":false' /var/log/agenshield/audit.log | tail -5

# Shows recent policy denials
```

## 12. Full Integration Test

```bash
# Run full integration test as clawagent
sudo -u clawagent bash << 'EOF'
echo "=== AgenShield Integration Test ==="

echo "1. Testing ping..."
/Users/clawagent/bin/shieldctl ping

echo "2. Testing file read (workspace)..."
echo "test" > /Users/clawagent/workspace/test.txt
/Users/clawagent/bin/shieldctl file read /Users/clawagent/workspace/test.txt

echo "3. Testing HTTP request..."
/Users/clawagent/bin/shieldctl http GET https://api.github.com/zen

echo "4. Testing blocked direct network..."
if curl -s --max-time 5 https://example.com > /dev/null 2>&1; then
  echo "FAIL: Direct network should be blocked"
else
  echo "PASS: Direct network is blocked"
fi

echo "=== Test Complete ==="
EOF
```

## Troubleshooting

### Daemon Not Running

```bash
# Check daemon status
launchctl list | grep agenshield

# View daemon logs
tail -50 /var/log/agenshield/broker.error.log

# Restart daemon
sudo launchctl unload /Library/LaunchDaemons/com.agenshield.broker.plist
sudo launchctl load /Library/LaunchDaemons/com.agenshield.broker.plist
```

### Socket Permission Issues

```bash
# Reset socket directory permissions
sudo chown clawbroker:clawshield /var/run/agenshield
sudo chmod 770 /var/run/agenshield
```

### User Cannot Access Workspace

```bash
# Fix workspace permissions
sudo chown -R clawagent:clawworkspace /Users/clawagent/workspace
sudo chmod -R 2775 /Users/clawagent/workspace
```

### Seatbelt Errors

```bash
# Test profile syntax
/usr/bin/sandbox-exec -n "test" -f /etc/agenshield/seatbelt/agent.sb echo "test"

# If errors, check profile format
cat /etc/agenshield/seatbelt/agent.sb
```

## Health Check Script

Save this as `/opt/agenshield/bin/healthcheck`:

```bash
#!/bin/bash

echo "AgenShield Health Check"
echo "======================"

# Check groups
echo -n "Groups: "
if dscl . -read /Groups/clawshield > /dev/null 2>&1 && \
   dscl . -read /Groups/clawworkspace > /dev/null 2>&1; then
  echo "OK"
else
  echo "FAIL"
fi

# Check users
echo -n "Users: "
if dscl . -read /Users/clawagent > /dev/null 2>&1 && \
   dscl . -read /Users/clawbroker > /dev/null 2>&1; then
  echo "OK"
else
  echo "FAIL"
fi

# Check directories
echo -n "Directories: "
if [ -d /opt/agenshield ] && [ -d /etc/agenshield ] && \
   [ -d /var/run/agenshield ] && [ -d /var/log/agenshield ]; then
  echo "OK"
else
  echo "FAIL"
fi

# Check daemon
echo -n "Daemon: "
if curl -s http://localhost:6969/api/health | grep -q '"status":"ok"'; then
  echo "OK"
else
  echo "FAIL"
fi

# Check socket
echo -n "Socket: "
if [ -S /var/run/agenshield/agenshield.sock ]; then
  echo "OK"
else
  echo "FAIL (broker may not be running)"
fi

echo "======================"
```

Run with: `sudo /opt/agenshield/bin/healthcheck`
