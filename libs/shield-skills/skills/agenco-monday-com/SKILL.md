---
name: agenco-monday-com
description: "monday.com actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# monday.com

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| get_boards | Lists all available boards to find workspaces and projects |
| get_board_items | Retrieves items from a specific board with column values |
| create_item | Creates new items on a board with specified column values |
| update_item_name | Changes the name of an existing item |
| change_column_value | Updates specific column values like status, date, or person |
| delete_item | Removes an item from the board |
| create_board | Creates a new board with specified columns and structure |
| create_column | Adds new columns to boards for additional data tracking |
| create_update | Posts updates and comments on items for team communication |
| get_users | Retrieves team members for assignment and collaboration |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["monday com get boards"]}'
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
agenco search-tools '{"queries":["monday com get boards"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"monday-com_get_boards","input":{...}}'
```

> If monday.com is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
