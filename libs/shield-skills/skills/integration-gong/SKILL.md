---
name: integration-gong
description: "Gong actions available through AgentLink"
user-invocable: false
disable-model-invocation: false
---

# Gong

Actions available through AgentLink secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_calls | Retrieves recorded sales calls |
| get_call | Fetches call details and metadata |
| get_transcript | Retrieves call transcription |
| list_users | Gets team members |
| get_user_stats | Retrieves user performance metrics |
| list_workspaces | Gets available workspaces |
| get_activity_stats | Retrieves activity analytics |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agentlink search-tools '{"queries":["gong list calls"]}'
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
agentlink search-tools '{"queries":["gong list calls"]}'

# Call it (use the exact toolName and schema from the search result)
agentlink call-tool '{"toolName":"gong_list_calls","input":{...}}'
```

> If Gong is not connected, run `agentlink list-connected-integrations` to check, then connect it via the Shield UI.
