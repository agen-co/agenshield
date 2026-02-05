---
name: integration-power-bi
description: "Power BI actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Power BI

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_datasets | Retrieves available datasets |
| refresh_dataset | Triggers data refresh for datasets |
| list_reports | Gets published reports |
| get_report | Fetches report details and pages |
| list_dashboards | Retrieves dashboards with tiles |
| list_workspaces | Gets available workspaces and groups |
| export_report | Exports reports to file formats |
| create_dataset | Creates new push datasets |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["power bi list datasets"]}'
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
agenco search-tools '{"queries":["power bi list datasets"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"power-bi_list_datasets","input":{...}}'
```

> If Power BI is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
