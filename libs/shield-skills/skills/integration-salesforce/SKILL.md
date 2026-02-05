---
name: integration-salesforce
description: "Salesforce actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Salesforce

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| query_records | Executes SOQL queries to retrieve CRM data across objects |
| search_records | Performs SOSL searches across multiple objects |
| create_account | Creates new company account records in the CRM |
| get_account | Retrieves account details including related contacts and opportunities |
| create_contact | Creates new contact records associated with accounts |
| create_lead | Adds new lead records for sales pipeline |
| create_opportunity | Creates new sales opportunities with stage and value |
| update_record | Modifies existing records across any Salesforce object |
| create_case | Opens new support cases for customer issues |
| describe_object | Gets metadata about object fields and relationships |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["salesforce query records"]}'
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
agenco search-tools '{"queries":["salesforce query records"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"salesforce_query_records","input":{...}}'
```

> If Salesforce is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
