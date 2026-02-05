---
name: integration-airtable
description: "Airtable actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Airtable

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_bases | Retrieves all bases the user can access |
| get_base_schema | Fetches tables and fields structure |
| list_records | Retrieves records from a table with views and filters |
| get_record | Fetches a specific record with all field values |
| create_record | Adds new records to tables with field values |
| update_record | Modifies field values on existing records |
| delete_record | Removes records from tables |
| batch_create_records | Creates multiple records in a single request |
| list_fields | Gets field definitions for tables |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["airtable list bases"]}'
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
agenco search-tools '{"queries":["airtable list bases"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"airtable_list_bases","input":{...}}'
```

> If Airtable is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
