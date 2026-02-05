---
name: integration-linear
description: "Linear actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Linear

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| get_issues | Retrieves project issues from Linear |
| create_issue | Creates new issues in Linear |
| get_teams | Retrieves team information from Linear |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["linear get issues"]}'
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
agenco search-tools '{"queries":["linear get issues"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"linear_get_issues","input":{...}}'
```

> If Linear is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
