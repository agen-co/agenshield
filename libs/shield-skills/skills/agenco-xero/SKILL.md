---
name: agenco-xero
description: "Xero actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Xero

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_invoices | Retrieves sales invoices with status information |
| get_invoice | Fetches invoice details and line items |
| create_invoice | Creates new sales invoices |
| update_invoice | Modifies invoice details |
| list_contacts | Retrieves customer and supplier contacts |
| create_contact | Creates new contact records |
| list_accounts | Gets chart of accounts |
| create_payment | Records payments against invoices |
| get_reports | Retrieves financial reports |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["xero list invoices"]}'
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
agenco search-tools '{"queries":["xero list invoices"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"xero_list_invoices","input":{...}}'
```

> If Xero is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
