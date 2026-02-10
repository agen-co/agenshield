---
name: agenco-help-scout
description: "Help Scout actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Help Scout

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_conversations | Retrieves support conversations from Help Scout |
| get_conversation | Fetches detailed information about a specific conversation |
| create_conversation | Opens new support conversations in Help Scout |
| update_conversation | Modifies conversation status and properties |
| list_customers | Retrieves customer records from Help Scout |
| get_customer | Fetches detailed customer information |
| create_customer | Creates new customer records in Help Scout |
| list_mailboxes | Gets available mailboxes for organizing support channels |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["help scout list conversations"]}'
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
agenco search-tools '{"queries":["help scout list conversations"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"help-scout_list_conversations","input":{...}}'
```

> If Help Scout is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
