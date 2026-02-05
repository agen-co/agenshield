---
name: integration-facebook
description: "Facebook actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Facebook

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| get_profile | Retrieves user profile information |
| list_posts | Gets posts from timeline |
| create_post | Publishes new posts |
| list_pages | Retrieves managed pages |
| get_page | Fetches page details |
| get_feed | Retrieves news feed |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["facebook get profile"]}'
```

The response includes `toolName` (exact name) and `inputSchema` (required/optional parameters).

### Step 2: Call the tool

Use the exact `toolName` and match the `inputSchema` from the search results:

```bash
agenco call-tool '{"toolName":"<toolName from search>","input":{...}}'
```

### Example

```bash
# Find the right tool
agenco search-tools '{"queries":["facebook get profile"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"facebook_get_profile","input":{...}}'
```

> If Facebook is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
