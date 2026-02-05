---
name: integration-linkedin
description: "LinkedIn actions available through AgentLink"
user-invocable: false
disable-model-invocation: false
---

# LinkedIn

Actions available through AgentLink secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| get_profile | Retrieves the user's LinkedIn profile information |
| create_post | Publishes new posts to the LinkedIn feed |
| get_post | Retrieves post details and engagement metrics |
| delete_post | Removes posts from the feed |
| list_posts | Gets recent posts from the user's profile |
| create_comment | Posts comments on LinkedIn posts |
| get_organization | Retrieves company page information |
| upload_image | Uploads images for use in posts |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agentlink search-tools '{"queries":["linkedin get profile"]}'
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
agentlink search-tools '{"queries":["linkedin get profile"]}'

# Call it (use the exact toolName and schema from the search result)
agentlink call-tool '{"toolName":"linkedin_get_profile","input":{...}}'
```

> If LinkedIn is not connected, run `agentlink list-connected-integrations` to check, then connect it via the Shield UI.
