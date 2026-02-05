---
name: integration-grafana
description: "Grafana actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Grafana

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_dashboards | Retrieves Grafana dashboards |
| get_dashboard | Fetches detailed dashboard information |
| create_dashboard | Generates new dashboards |
| delete_dashboard | Removes existing dashboards |
| list_datasources | Retrieves available data sources |
| list_alerts | Obtains alert rules configured in the system |
| create_annotation | Adds annotations to graphs for documentation |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["grafana list dashboards"]}'
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
agenco search-tools '{"queries":["grafana list dashboards"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"grafana_list_dashboards","input":{...}}'
```

> If Grafana is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
