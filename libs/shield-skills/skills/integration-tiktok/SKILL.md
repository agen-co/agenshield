---
name: integration-tiktok
description: "TikTok actions available through AgentLink"
user-invocable: false
disable-model-invocation: false
---

# TikTok

Actions available through AgentLink secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| get_user_info | Retrieves account information |
| list_videos | Gets posted videos |
| query_videos | Searches videos with filters |
| initialize_upload | Starts video upload process |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agentlink search-tools '{"queries":["tiktok get user info"]}'
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
agentlink search-tools '{"queries":["tiktok get user info"]}'

# Call it (use the exact toolName and schema from the search result)
agentlink call-tool '{"toolName":"tiktok_get_user_info","input":{...}}'
```

> If TikTok is not connected, run `agentlink list-connected-integrations` to check, then connect it via the Shield UI.
