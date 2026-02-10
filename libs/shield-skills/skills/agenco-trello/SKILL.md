---
name: agenco-trello
description: "Trello actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Trello

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| get_board | Retrieves board details and settings |
| list_boards | Gets all boards the user can access |
| create_board | Creates new boards with lists and settings |
| list_lists | Gets lists on a board for card organization |
| create_list | Adds new lists to boards |
| get_card | Retrieves card details including checklists and attachments |
| create_card | Creates new cards on lists with descriptions and labels |
| update_card | Modifies card content, labels, or list position |
| move_card | Moves cards between lists or boards |
| add_comment | Posts comments on cards for discussion |
| add_checklist | Creates checklists on cards for task tracking |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["trello get board"]}'
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
agenco search-tools '{"queries":["trello get board"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"trello_get_board","input":{...}}'
```

> If Trello is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
