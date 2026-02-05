---
name: integration-hubspot-crm
description: "HubSpot CRM actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# HubSpot CRM

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_contacts | Retrieves CRM contacts |
| get_contact | Fetches contact details and timeline |
| create_contact | Creates new contact records |
| list_companies | Retrieves company records |
| create_company | Creates new company records |
| list_deals | Gets sales pipeline deals |
| create_deal | Creates new deals in pipeline |
| list_owners | Gets sales team members |
| list_pipelines | Retrieves deal pipelines |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["hubspot crm list contacts"]}'
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
agenco search-tools '{"queries":["hubspot crm list contacts"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"hubspot-crm_list_contacts","input":{...}}'
```

> If HubSpot CRM is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
