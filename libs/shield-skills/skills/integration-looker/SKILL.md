---
name: integration-looker
description: "Looker actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Looker

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_dashboards | Retrieves available dashboards with read permissions |
| get_dashboard | Fetches dashboard details and tiles |
| create_dashboard | Generates new dashboards with write permissions |
| list_looks | Retrieves saved looks and visualizations |
| run_look | Executes looks to retrieve data |
| create_query | Builds new data queries with write permissions |
| run_query | Executes queries and returns results |
| list_users | Retrieves Looker users with read permissions |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["looker list dashboards"]}'
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
agenco search-tools '{"queries":["looker list dashboards"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"looker_list_dashboards","input":{...}}'
```

> If Looker is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
