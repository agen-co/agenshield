---
name: integration-onenote
description: "OneNote actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# OneNote

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_notebooks | Retrieves OneNote notebooks with read access |
| get_notebook | Fetches detailed notebook information |
| list_sections | Gets sections contained within notebooks |
| create_section | Creates new sections in notebooks |
| list_pages | Retrieves pages from specific sections |
| create_page | Creates new pages with content |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["onenote list notebooks"]}'
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
agenco search-tools '{"queries":["onenote list notebooks"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"onenote_list_notebooks","input":{...}}'
```

> If OneNote is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
