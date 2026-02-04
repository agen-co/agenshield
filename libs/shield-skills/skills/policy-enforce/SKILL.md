---
name: policy-enforce
description: Check if a specific action would be allowed by policy
user-invocable: true
disable-model-invocation: false
command-dispatch: bash
command-tool: Bash
command-arg-mode: multi

requires:
  bins:
    - shieldctl

agenshield:
  policy: builtin-policy-check
  allowed-commands:
    - shieldctl policy check
  required-approval: false
  audit-level: debug
---

# Policy Enforce

Check if a specific action would be allowed by the current policy configuration.

## Usage

```bash
# Check if an HTTP request would be allowed
shieldctl policy check http_request https://api.example.com

# Check if a file read would be allowed
shieldctl policy check file_read /path/to/file.txt

# Check if a command would be allowed
shieldctl policy check exec "curl https://example.com"
```

## Operations

| Operation | Description | Example Target |
|-----------|-------------|----------------|
| `http_request` | HTTP/HTTPS requests | `https://api.example.com` |
| `file_read` | Read file contents | `/path/to/file.txt` |
| `file_write` | Write file contents | `/path/to/output.txt` |
| `file_list` | List directory | `/path/to/directory` |
| `exec` | Execute command | `ls -la` |
| `open_url` | Open in browser | `https://example.com` |

## Example Output

### Allowed

```
Policy Check: http_request -> https://api.github.com
Result: ALLOWED
Policy: builtin-allow-github (priority: 50)
```

### Denied

```
Policy Check: http_request -> https://malicious-site.com
Result: DENIED
Reason: Host 'malicious-site.com' is not in allowlist
Policy: network-constraints
```

## Understanding Policies

Policies are evaluated in priority order (highest first):

1. **Denylist rules** - Block specific patterns
2. **Allowlist rules** - Allow specific patterns
3. **Constraints** - Network and filesystem constraints
4. **Default action** - Applied when no rules match

## Debugging

If an operation is unexpectedly blocked:

```bash
# View all policies
shieldctl policies list

# Check specific policy details
shieldctl policies get <policy-id>

# View recent audit log
tail -20 /var/log/agenshield/audit.log
```
