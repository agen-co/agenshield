---
name: integration-akamai
description: "Akamai actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Akamai

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_properties | Retrieves edge configurations |
| get_property | Fetches property details |
| purge_cache | Clears cached content |
| get_reports | Retrieves traffic reports |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["akamai list properties"]}'
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
agenco search-tools '{"queries":["akamai list properties"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"akamai_list_properties","input":{...}}'
```

> If Akamai is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
