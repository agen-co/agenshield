---
name: agenco-pardot
description: "Pardot actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Pardot

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_prospects | Retrieves prospect records from the system |
| get_prospect | Fetches detailed information about a specific prospect |
| create_prospect | Establishes new prospect entries in the database |
| update_prospect | Modifies existing prospect data and attributes |
| list_campaigns | Retrieves available marketing campaigns |
| list_forms | Obtains lead form configurations and details |
| list_visitors | Gathers website visitor tracking and engagement data |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["pardot list prospects"]}'
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
agenco search-tools '{"queries":["pardot list prospects"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"pardot_list_prospects","input":{...}}'
```

> If Pardot is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
