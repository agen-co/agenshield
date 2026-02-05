---
name: integration-victorops
description: "VictorOps actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# VictorOps

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_incidents | Retrieves active incidents from VictorOps |
| get_incident | Fetches detailed information about specific incidents |
| create_incident | Triggers new incidents in the system |
| acknowledge_incident | Marks incidents as acknowledged by responders |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["victorops list incidents"]}'
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
agenco search-tools '{"queries":["victorops list incidents"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"victorops_list_incidents","input":{...}}'
```

> If VictorOps is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
