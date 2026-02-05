---
name: integration-square
description: "Square actions available through AgentLink"
user-invocable: false
disable-model-invocation: false
---

# Square

Actions available through AgentLink secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| create_payment | Processes payments for orders |
| get_payment | Retrieves payment details and status |
| list_payments | Gets payment history with filters |
| create_order | Creates orders for payment processing |
| get_order | Retrieves order details and line items |
| create_customer | Creates customer records for transactions |
| list_customers | Retrieves customer database |
| list_catalog_items | Gets products and services from catalog |
| create_refund | Issues refunds for previous payments |
| list_locations | Retrieves business locations |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agentlink search-tools '{"queries":["square create payment"]}'
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
agentlink search-tools '{"queries":["square create payment"]}'

# Call it (use the exact toolName and schema from the search result)
agentlink call-tool '{"toolName":"square_create_payment","input":{...}}'
```

> If Square is not connected, run `agentlink list-connected-integrations` to check, then connect it via the Shield UI.
