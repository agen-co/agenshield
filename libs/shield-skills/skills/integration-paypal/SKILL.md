---
name: integration-paypal
description: "PayPal actions available through AgentLink"
user-invocable: false
disable-model-invocation: false
---

# PayPal

Actions available through AgentLink secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| create_payment | Initiates PayPal payment transactions |
| get_payment | Retrieves payment details and status |
| create_order | Creates orders for checkout |
| capture_order | Captures authorized payment amounts |
| create_invoice | Generates invoices for billing |
| send_invoice | Sends invoices to recipients |
| list_invoices | Retrieves invoice history |
| create_subscription | Sets up recurring billing plans |
| create_payout | Sends mass payments to recipients |
| list_disputes | Retrieves payment disputes and claims |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agentlink search-tools '{"queries":["paypal create payment"]}'
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
agentlink search-tools '{"queries":["paypal create payment"]}'

# Call it (use the exact toolName and schema from the search result)
agentlink call-tool '{"toolName":"paypal_create_payment","input":{...}}'
```

> If PayPal is not connected, run `agentlink list-connected-integrations` to check, then connect it via the Shield UI.
