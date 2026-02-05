---
name: integration-dynatrace
description: "Dynatrace actions available through AgentLink"
user-invocable: false
disable-model-invocation: false
---

# Dynatrace

Actions available through AgentLink secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_entities | Retrieves monitored entities |
| get_entity | Fetches entity details |
| list_problems | Gets detected problems |
| get_metrics | Retrieves metric data |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agentlink search-tools '{"queries":["dynatrace list entities"]}'
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
agentlink search-tools '{"queries":["dynatrace list entities"]}'

# Call it (use the exact toolName and schema from the search result)
agentlink call-tool '{"toolName":"dynatrace_list_entities","input":{...}}'
```

> If Dynatrace is not connected, run `agentlink list-connected-integrations` to check, then connect it via the Shield UI.
