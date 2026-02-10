---
name: agenco-optimizely
description: "Optimizely actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Optimizely

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_projects | Retrieves experimentation projects |
| get_project | Fetches project details |
| list_experiments | Gets experiments |
| get_experiment | Fetches experiment details |
| create_experiment | Creates new experiments |
| update_experiment | Modifies experiment settings |
| get_results | Retrieves experiment results |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["optimizely list projects"]}'
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
agenco search-tools '{"queries":["optimizely list projects"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"optimizely_list_projects","input":{...}}'
```

> If Optimizely is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
