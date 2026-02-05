---
name: integration-bitbucket
description: "Bitbucket actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Bitbucket

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_repositories | Retrieves accessible repositories from your Bitbucket workspace |
| list_pull_requests | Gets pull requests to facilitate code review workflows |
| list_issues | Retrieves repository issues for project tracking and management |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["bitbucket list repositories"]}'
```

The response includes `toolName` (exact name) and `inputSchema` (required/optional parameters).

### Step 2: Call the tool

Use the exact `toolName` and match the `inputSchema` from the search results:

```bash
agenco call-tool '{"toolName":"<toolName from search>","input":{...}}'
```

### Example

```bash
# Find the right tool
agenco search-tools '{"queries":["bitbucket list repositories"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"bitbucket_list_repositories","input":{...}}'
```

> If Bitbucket is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
