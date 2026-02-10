---
name: agenco-tableau
description: "Tableau actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Tableau

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_workbooks | Retrieves published workbooks from Tableau Server |
| get_workbook | Fetches workbook details and associated views |
| list_views | Gets views contained within workbooks |
| get_view_image | Renders a view as an image suitable for embedding |
| list_data_sources | Retrieves published data sources |
| list_projects | Gets projects used for organizing content |
| publish_workbook | Uploads workbooks to Tableau Server |
| list_users | Retrieves Tableau Server users |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["tableau list workbooks"]}'
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
agenco search-tools '{"queries":["tableau list workbooks"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"tableau_list_workbooks","input":{...}}'
```

> If Tableau is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
