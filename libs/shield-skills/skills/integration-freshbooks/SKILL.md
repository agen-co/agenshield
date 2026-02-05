---
name: integration-freshbooks
description: "FreshBooks actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# FreshBooks

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_clients | Retrieves client records |
| get_client | Fetches client details and invoices |
| create_client | Creates new client accounts |
| list_invoices | Gets invoices with payment status |
| create_invoice | Creates new client invoices |
| list_expenses | Retrieves expense records |
| create_expense | Records new business expenses |
| list_payments | Gets payment records |
| get_current_user | Retrieves authenticated user info |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["freshbooks list clients"]}'
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
agenco search-tools '{"queries":["freshbooks list clients"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"freshbooks_list_clients","input":{...}}'
```

> If FreshBooks is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
