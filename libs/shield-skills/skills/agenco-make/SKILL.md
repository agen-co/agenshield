---
name: agenco-make
description: "Make actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Make

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_scenarios | Retrieves Make scenarios |
| get_scenario | Fetches scenario details |
| run_scenario | Triggers scenario execution |
| list_executions | Gets execution history |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["make list scenarios"]}'
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
agenco search-tools '{"queries":["make list scenarios"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"make_list_scenarios","input":{...}}'
```

> If Make is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
