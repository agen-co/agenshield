---
name: integration-discord
description: "Discord actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Discord

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| get_current_user | Retrieves authenticated user info |
| list_guilds | Gets servers the user is in |
| get_guild | Fetches server details |
| list_channels | Gets channels in a server |
| create_channel | Creates new channels |
| list_messages | Retrieves channel messages |
| send_message | Posts messages to channels |
| delete_message | Removes messages from channels |
| create_webhook | Creates webhooks for integrations |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["discord get current user"]}'
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
agenco search-tools '{"queries":["discord get current user"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"discord_get_current_user","input":{...}}'
```

> If Discord is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
