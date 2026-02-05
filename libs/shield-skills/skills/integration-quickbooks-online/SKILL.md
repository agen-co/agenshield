---
name: integration-quickbooks-online
description: "QuickBooks Online actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# QuickBooks Online

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| create_customer | Generates new customer records in QuickBooks |
| list_customers | Retrieves customer list with balances |
| create_invoice | Generates invoices for customer billing |
| list_invoices | Retrieves invoice history and status |
| create_payment | Records customer payments against invoices |
| list_items | Gets products and services for invoicing |
| list_accounts | Retrieves chart of accounts |
| get_profit_loss_report | Generates profit and loss statements |
| get_balance_sheet | Retrieves balance sheet reports |
| list_vendors | Gets vendor records for bill tracking |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["quickbooks online create customer"]}'
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
agenco search-tools '{"queries":["quickbooks online create customer"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"quickbooks-online_create_customer","input":{...}}'
```

> If QuickBooks Online is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
