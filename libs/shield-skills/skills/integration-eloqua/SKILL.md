---
name: integration-eloqua
description: "Eloqua actions available through AgentLink"
user-invocable: false
disable-model-invocation: false
---

# Eloqua

Actions available through AgentLink secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_contacts | Retrieves contact records |
| get_contact | Fetches contact details |
| create_contact | Creates new contacts |
| update_contact | Modifies contact information |
| list_campaigns | Gets marketing campaigns |
| list_emails | Retrieves email assets |
| list_forms | Gets marketing forms |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agentlink search-tools '{"queries":["eloqua list contacts"]}'
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
agentlink search-tools '{"queries":["eloqua list contacts"]}'

# Call it (use the exact toolName and schema from the search result)
agentlink call-tool '{"toolName":"eloqua_list_contacts","input":{...}}'
```

> If Eloqua is not connected, run `agentlink list-connected-integrations` to check, then connect it via the Shield UI.
