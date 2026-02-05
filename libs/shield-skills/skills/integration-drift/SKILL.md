---
name: integration-drift
description: "Drift actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Drift

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_conversations | Retrieves chat conversations |
| get_conversation | Fetches conversation messages |
| create_conversation | Starts new conversations |
| send_message | Sends messages in conversations |
| list_contacts | Retrieves contact records |
| get_contact | Fetches contact details |
| create_contact | Creates new contact records |
| list_users | Gets team members |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["drift list conversations"]}'
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
agenco search-tools '{"queries":["drift list conversations"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"drift_list_conversations","input":{...}}'
```

> If Drift is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
