---
name: agenco-aweber
description: "AWeber actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# AWeber

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_subscribers | Retrieves subscriber list from your AWeber account |
| get_subscriber | Fetches detailed information about a specific subscriber |
| create_subscriber | Adds new subscribers to your mailing lists |
| update_subscriber | Modifies existing subscriber information |
| list_lists | Gets all available mailing lists |
| list_campaigns | Retrieves your email campaigns |
| list_broadcasts | Gets email broadcasts you've sent |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["aweber list subscribers"]}'
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
agenco search-tools '{"queries":["aweber list subscribers"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"aweber_list_subscribers","input":{...}}'
```

> If AWeber is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
