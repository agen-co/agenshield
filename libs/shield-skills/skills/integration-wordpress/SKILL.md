---
name: integration-wordpress
description: "WordPress actions available through AgentLink"
user-invocable: false
disable-model-invocation: false
---

# WordPress

Actions available through AgentLink secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| get_current_user | Retrieves authenticated user information |
| list_sites | Retrieves WordPress sites |
| list_posts | Fetches blog posts |
| create_post | Generates new blog posts |
| update_post | Modifies existing post content |
| delete_post | Removes blog posts |
| list_pages | Retrieves site pages |
| upload_media | Uploads images and files to WordPress |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agentlink search-tools '{"queries":["wordpress get current user"]}'
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
agentlink search-tools '{"queries":["wordpress get current user"]}'

# Call it (use the exact toolName and schema from the search result)
agentlink call-tool '{"toolName":"wordpress_get_current_user","input":{...}}'
```

> If WordPress is not connected, run `agentlink list-connected-integrations` to check, then connect it via the Shield UI.
