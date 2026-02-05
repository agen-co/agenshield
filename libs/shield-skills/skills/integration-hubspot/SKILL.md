---
name: integration-hubspot
description: "HubSpot actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# HubSpot

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| create_contact | Establishes new contact records with properties and associations |
| get_contact | Retrieves contact details including engagement history |
| update_contact | Modifies contact properties and list memberships |
| search_contacts | Queries contacts by properties or engagement data |
| create_company | Establishes new company records in the CRM |
| create_deal | Opens new deals in the sales pipeline with stage and amount |
| search_deals | Queries deals by properties, stage, or owner |
| create_ticket | Opens support tickets for customer service tracking |
| list_owners | Retrieves sales team members for deal assignment |
| create_association | Links related records like contacts to companies |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["hubspot create contact"]}'
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
agenco search-tools '{"queries":["hubspot create contact"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"hubspot_create_contact","input":{...}}'
```

> If HubSpot is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
