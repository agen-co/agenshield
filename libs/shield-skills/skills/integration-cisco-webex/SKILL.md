---
name: integration-cisco-webex
description: "Cisco Webex actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Cisco Webex

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| get_current_user | Retrieves authenticated user information |
| list_rooms | Obtains Webex spaces and rooms |
| create_room | Establishes new Webex spaces |
| list_messages | Retrieves messages from rooms |
| send_message | Posts messages to rooms |
| delete_message | Removes messages from rooms |
| list_memberships | Obtains room members |
| list_meetings | Retrieves scheduled meetings |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["cisco webex get current user"]}'
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
agenco search-tools '{"queries":["cisco webex get current user"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"cisco-webex_get_current_user","input":{...}}'
```

> If Cisco Webex is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
