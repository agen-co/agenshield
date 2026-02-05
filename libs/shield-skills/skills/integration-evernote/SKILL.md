---
name: integration-evernote
description: "Evernote actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Evernote

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_notebooks | Retrieves available notebooks |
| get_notebook | Fetches notebook details |
| create_notebook | Creates new notebooks |
| list_notes | Gets notes from notebooks |
| get_note | Retrieves note content |
| create_note | Creates new notes |
| update_note | Modifies note content |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["evernote list notebooks"]}'
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
agenco search-tools '{"queries":["evernote list notebooks"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"evernote_list_notebooks","input":{...}}'
```

> If Evernote is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
