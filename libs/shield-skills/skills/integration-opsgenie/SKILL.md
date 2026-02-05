---
name: integration-opsgenie
description: "OpsGenie actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# OpsGenie

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_alerts | Retrieves active alerts from your incident management system |
| get_alert | Fetches detailed information about a specific alert |
| create_alert | Generates new alerts within OpsGenie |
| acknowledge_alert | Marks alerts as acknowledged by team members |
| close_alert | Resolves and closes alerts that have been addressed |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["opsgenie list alerts"]}'
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
agenco search-tools '{"queries":["opsgenie list alerts"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"opsgenie_list_alerts","input":{...}}'
```

> If OpsGenie is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
