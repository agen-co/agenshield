---
name: integration-appdynamics
description: "AppDynamics actions available through AgentLink"
user-invocable: false
disable-model-invocation: false
---

# AppDynamics

Actions available through AgentLink secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_applications | Retrieves monitored applications |
| get_application | Fetches application details |
| list_tiers | Gets application tiers |
| get_metrics | Retrieves performance metrics |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agentlink search-tools '{"queries":["appdynamics list applications"]}'
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
agentlink search-tools '{"queries":["appdynamics list applications"]}'

# Call it (use the exact toolName and schema from the search result)
agentlink call-tool '{"toolName":"appdynamics_list_applications","input":{...}}'
```

> If AppDynamics is not connected, run `agentlink list-connected-integrations` to check, then connect it via the Shield UI.
