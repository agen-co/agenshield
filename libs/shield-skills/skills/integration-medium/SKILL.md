---
name: integration-medium
description: "Medium actions available through AgentLink"
user-invocable: false
disable-model-invocation: false
---

# Medium

Actions available through AgentLink secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| get_current_user | Retrieves authenticated user info |
| list_publications | Gets user publications |
| list_posts | Retrieves published posts |
| create_post | Publishes new articles |
| upload_image | Uploads images for posts |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agentlink search-tools '{"queries":["medium get current user"]}'
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
agentlink search-tools '{"queries":["medium get current user"]}'

# Call it (use the exact toolName and schema from the search result)
agentlink call-tool '{"toolName":"medium_get_current_user","input":{...}}'
```

> If Medium is not connected, run `agentlink list-connected-integrations` to check, then connect it via the Shield UI.
