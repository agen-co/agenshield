---
name: integration-hubspot-service
description: "HubSpot Service actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# HubSpot Service

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_tickets | Retrieves support tickets from the system |
| get_ticket | Fetches detailed information about a specific ticket |
| create_ticket | Opens new support tickets in the system |
| update_ticket | Modifies ticket status and other properties |
| list_conversations | Gets support conversations available in the account |
| get_conversation | Fetches individual conversation messages |
| send_message | Sends messages within support conversations |
| list_knowledge_articles | Retrieves knowledge base articles for reference |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["hubspot service list tickets"]}'
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
agenco search-tools '{"queries":["hubspot service list tickets"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"hubspot-service_list_tickets","input":{...}}'
```

> If HubSpot Service is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
