---
name: integration-slack
description: "Slack actions available through AgentLink"
user-invocable: false
disable-model-invocation: false
---

# Slack

Actions available through AgentLink secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| send_messages | Sends messages to Slack channels or DMs for notifications, updates, or automated replies |
| list_channels | Retrieves public Slack channels to determine where messages or actions can be sent |
| read_channel_messages | Fetches recent or past messages from a public channel for context and activity tracking |
| upload_files | Uploads files to Slack channels or DMs, such as reports, documents, or images |
| add_reactions | Adds emoji reactions to messages to acknowledge requests or indicate status |
| search_messages | Searches Slack messages and files to find relevant conversations or historical content |
| create_channel | Creates new public or private channels for team collaboration |
| invite_to_channel | Invites users to join specific channels |
| get_user_info | Retrieves profile information about Slack workspace members |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agentlink search-tools '{"queries":["slack send messages"]}'
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
agentlink search-tools '{"queries":["slack send messages"]}'

# Call it (use the exact toolName and schema from the search result)
agentlink call-tool '{"toolName":"slack_send_messages","input":{...}}'
```

> If Slack is not connected, run `agentlink list-connected-integrations` to check, then connect it via the Shield UI.
