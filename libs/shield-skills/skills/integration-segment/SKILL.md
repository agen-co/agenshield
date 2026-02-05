---
name: integration-segment
description: "Segment actions available through AgentLink"
user-invocable: false
disable-model-invocation: false
---

# Segment

Actions available through AgentLink secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_sources | Retrieves data sources |
| get_source | Fetches source configuration |
| create_source | Creates new data sources |
| list_destinations | Gets data destinations |
| track_event | Sends track events |
| identify_user | Sends identify calls |
| group_user | Associates users with groups |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agentlink search-tools '{"queries":["segment list sources"]}'
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
agentlink search-tools '{"queries":["segment list sources"]}'

# Call it (use the exact toolName and schema from the search result)
agentlink call-tool '{"toolName":"segment_list_sources","input":{...}}'
```

> If Segment is not connected, run `agentlink list-connected-integrations` to check, then connect it via the Shield UI.
