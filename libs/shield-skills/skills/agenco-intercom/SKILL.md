---
name: agenco-intercom
description: "Intercom actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Intercom

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_contacts | Retrieves customer contact records |
| get_contact | Fetches contact details and conversation history |
| create_contact | Creates new contact records |
| update_contact | Modifies contact properties and tags |
| list_conversations | Gets support conversations with filters |
| get_conversation | Retrieves conversation messages and details |
| reply_to_conversation | Sends replies in conversations |
| close_conversation | Marks conversations as closed |
| create_message | Sends new messages to contacts |
| list_tags | Gets available tags for categorization |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["intercom list contacts"]}'
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
agenco search-tools '{"queries":["intercom list contacts"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"intercom_list_contacts","input":{...}}'
```

> If Intercom is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
