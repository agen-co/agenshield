---
name: integration-stripe
description: "Stripe actions available through AgentLink"
user-invocable: false
disable-model-invocation: false
---

# Stripe

Actions available through AgentLink secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| create_customer | Generates new customer records for billing purposes |
| get_customer | Retrieves customer details and payment methods |
| create_payment_intent | Initiates payment processing for orders |
| get_payment_intent | Retrieves payment status and transaction details |
| create_charge | Processes one-time charges to payment methods |
| create_refund | Issues refunds for previous charges |
| list_subscriptions | Retrieves active and past subscriptions |
| create_subscription | Sets up recurring billing for customers |
| create_invoice | Generates invoices for customer billing |
| list_invoices | Retrieves invoice history for customers |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agentlink search-tools '{"queries":["stripe create customer"]}'
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
agentlink search-tools '{"queries":["stripe create customer"]}'

# Call it (use the exact toolName and schema from the search result)
agentlink call-tool '{"toolName":"stripe_create_customer","input":{...}}'
```

> If Stripe is not connected, run `agentlink list-connected-integrations` to check, then connect it via the Shield UI.
