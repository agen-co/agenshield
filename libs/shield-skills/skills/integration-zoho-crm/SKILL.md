---
name: integration-zoho-crm
description: "Zoho CRM actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Zoho CRM

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_leads | Retrieves lead records |
| create_lead | Creates new lead records |
| list_contacts | Retrieves contact records |
| list_accounts | Gets company account records |
| list_deals | Retrieves sales opportunities |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["zoho crm list leads"]}'
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
agenco search-tools '{"queries":["zoho crm list leads"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"zoho-crm_list_leads","input":{...}}'
```

> If Zoho CRM is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
