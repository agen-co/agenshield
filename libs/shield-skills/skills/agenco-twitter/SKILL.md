---
name: agenco-twitter
description: "Twitter actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Twitter

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| create_tweet | Posts new tweets to timeline |
| get_tweet | Retrieves tweet details |
| delete_tweet | Removes tweets from timeline |
| get_user | Fetches user profile information |
| lookup_users | Retrieves multiple user profiles |
| get_timeline | Gets reverse chronological home timeline |
| get_mentions | Retrieves mention timeline |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["twitter create tweet"]}'
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
agenco search-tools '{"queries":["twitter create tweet"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"twitter_create_tweet","input":{...}}'
```

> If Twitter is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
