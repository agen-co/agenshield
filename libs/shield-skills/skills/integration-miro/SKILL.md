---
name: integration-miro
description: "Miro actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Miro

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_boards | Retrieves accessible Miro boards |
| get_board | Fetches board details and content |
| create_board | Establishes new Miro boards |
| list_items | Obtains items on boards |
| create_item | Adds new items to boards |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["miro list boards"]}'
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
agenco search-tools '{"queries":["miro list boards"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"miro_list_boards","input":{...}}'
```

> If Miro is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
