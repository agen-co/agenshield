---
name: integration-reddit
description: "Reddit actions available through AgentLink"
user-invocable: false
disable-model-invocation: false
---

# Reddit

Actions available through AgentLink secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| get_me | Retrieves authenticated user info |
| get_user | Fetches user profile |
| list_subreddits | Gets subscribed subreddits |
| list_posts | Retrieves subreddit posts |
| create_post | Submits new posts to subreddits |
| delete_post | Removes posts |
| list_comments | Gets post comments |
| create_comment | Posts comments on threads |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agentlink search-tools '{"queries":["reddit get me"]}'
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
agentlink search-tools '{"queries":["reddit get me"]}'

# Call it (use the exact toolName and schema from the search result)
agentlink call-tool '{"toolName":"reddit_get_me","input":{...}}'
```

> If Reddit is not connected, run `agentlink list-connected-integrations` to check, then connect it via the Shield UI.
