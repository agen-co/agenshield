---
name: integration-campaign-monitor
description: "Campaign Monitor actions available through AgentLink"
user-invocable: false
disable-model-invocation: false
---

# Campaign Monitor

Actions available through AgentLink secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_clients | Retrieves client accounts |
| list_lists | Gets subscriber lists |
| add_subscriber | Adds new subscribers |
| get_subscriber | Fetches subscriber details |
| list_campaigns | Retrieves campaigns |
| create_campaign | Creates new campaigns |
| send_campaign | Sends campaigns to lists |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agentlink search-tools '{"queries":["campaign monitor list clients"]}'
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
agentlink search-tools '{"queries":["campaign monitor list clients"]}'

# Call it (use the exact toolName and schema from the search result)
agentlink call-tool '{"toolName":"campaign-monitor_list_clients","input":{...}}'
```

> If Campaign Monitor is not connected, run `agentlink list-connected-integrations` to check, then connect it via the Shield UI.
