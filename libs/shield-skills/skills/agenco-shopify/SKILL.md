---
name: agenco-shopify
description: "Shopify actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Shopify

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_products | Retrieves products from the store catalog |
| get_product | Fetches product details including variants and images |
| create_product | Adds new products to the catalog |
| update_product | Modifies product information and variants |
| list_orders | Retrieves orders with status filters |
| get_order | Fetches order details including items and customer |
| create_order | Creates new orders with line items |
| list_customers | Retrieves customer records from the store |
| create_fulfillment | Records shipment and tracking for orders |
| get_inventory_levels | Retrieves stock levels for products |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["shopify list products"]}'
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
agenco search-tools '{"queries":["shopify list products"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"shopify_list_products","input":{...}}'
```

> If Shopify is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
