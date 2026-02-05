---
name: integration-productboard
description: "Productboard actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Productboard

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_features | Retrieves product features |
| get_feature | Fetches feature details |
| create_feature | Creates new features |
| update_feature | Modifies feature information |
| list_notes | Gets customer feedback notes |
| create_note | Adds new feedback notes |
| list_products | Retrieves products |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["productboard list features"]}'
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
agenco search-tools '{"queries":["productboard list features"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"productboard_list_features","input":{...}}'
```

> If Productboard is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
