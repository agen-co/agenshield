---
name: integration-vwo
description: "VWO actions available through AgentLink"
user-invocable: false
disable-model-invocation: false
---

# VWO

Actions available through AgentLink secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_campaigns | Retrieves A/B test campaigns |
| get_campaign | Fetches detailed campaign information |
| create_campaign | Establishes new campaigns |
| start_campaign | Activates campaigns |
| stop_campaign | Pauses campaigns |
| get_reports | Retrieves campaign results |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agentlink search-tools '{"queries":["vwo list campaigns"]}'
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
agentlink search-tools '{"queries":["vwo list campaigns"]}'

# Call it (use the exact toolName and schema from the search result)
agentlink call-tool '{"toolName":"vwo_list_campaigns","input":{...}}'
```

> If VWO is not connected, run `agentlink list-connected-integrations` to check, then connect it via the Shield UI.
