---
name: agenco-snowflake
description: "Snowflake actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Snowflake

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| execute_query | Runs SQL queries on Snowflake for data warehousing and analytics automation |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["snowflake execute query"]}'
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
agenco search-tools '{"queries":["snowflake execute query"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"snowflake_execute_query","input":{...}}'
```

> If Snowflake is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
