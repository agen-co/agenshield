---
name: integration-front
description: "Front actions available through AgentLink"
user-invocable: false
disable-model-invocation: false
---

# Front

Actions available through AgentLink secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_conversations | Retrieves support conversations |
| get_conversation | Fetches conversation messages |
| create_conversation | Starts new conversations |
| list_messages | Gets messages in conversations |
| send_message | Sends messages in conversations |
| reply_to_message | Replies to existing messages |
| list_contacts | Retrieves contact records |
| list_inboxes | Gets available inboxes |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agentlink search-tools '{"queries":["front list conversations"]}'
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
agentlink search-tools '{"queries":["front list conversations"]}'

# Call it (use the exact toolName and schema from the search result)
agentlink call-tool '{"toolName":"front_list_conversations","input":{...}}'
```

> If Front is not connected, run `agentlink list-connected-integrations` to check, then connect it via the Shield UI.
