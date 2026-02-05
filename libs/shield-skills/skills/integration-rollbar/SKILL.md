---
name: integration-rollbar
description: "Rollbar actions available through AgentLink"
user-invocable: false
disable-model-invocation: false
---

# Rollbar

Actions available through AgentLink secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_projects | Retrieves monitored projects |
| list_items | Gets error items |
| get_item | Fetches error details |
| update_item | Modifies item status |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agentlink search-tools '{"queries":["rollbar list projects"]}'
```

The response includes `toolName` (exact name) and `inputSchema` (required/optional parameters).

### Step 2: Call the tool

Use the exact `toolName` and match the `inputSchema` from the search results:

```bash
agentlink call-tool '{"toolName":"<toolName from search>","input":{...}}'
```

### Example

```bash
# Find the right tool
agentlink search-tools '{"queries":["rollbar list projects"]}'

# Call it (use the exact toolName and schema from the search result)
agentlink call-tool '{"toolName":"rollbar_list_projects","input":{...}}'
```

> If Rollbar is not connected, run `agentlink list-connected-integrations` to check, then connect it via the Shield UI.
