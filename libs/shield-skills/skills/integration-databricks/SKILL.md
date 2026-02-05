---
name: integration-databricks
description: "Databricks actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Databricks

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_clusters | Retrieves compute clusters |
| list_jobs | Gets scheduled jobs |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["databricks list clusters"]}'
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
agenco search-tools '{"queries":["databricks list clusters"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"databricks_list_clusters","input":{...}}'
```

> If Databricks is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
