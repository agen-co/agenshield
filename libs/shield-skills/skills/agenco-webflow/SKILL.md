---
name: agenco-webflow
description: "Webflow actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Webflow

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_sites | Retrieves Webflow sites |
| get_site | Fetches site details |
| publish_site | Publishes site changes |
| list_collections | Gets CMS collections |
| list_items | Retrieves collection items |
| create_item | Adds new collection items |
| update_item | Modifies collection items |
| delete_item | Removes collection items |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["webflow list sites"]}'
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
agenco search-tools '{"queries":["webflow list sites"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"webflow_list_sites","input":{...}}'
```

> If Webflow is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
